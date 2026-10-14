import type { IncomingMessage, ServerResponse } from 'node:http'
import { createHash, timingSafeEqual } from 'node:crypto'
import { createReadStream, existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { join, normalize, sep } from 'node:path'
import { defineConfig, type Connect, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const MAP = /^mp_([a-z0-9_]+)\.ff$/i

export interface MapEntry {
  code: string
  /** arena `longname` of community maps */
  name?: string
  size: number
  /** path of the FastFile, relative to the folder it was found in */
  path: string
  /** archives sitting next to a community map (its own images), relative to the same folder */
  iwd: string[]
}

const isDir = (p: string) => { try { return statSync(p).isDirectory() } catch { return false } }

/**
 * Maps of a folder: `<base>/<dir>/mp_<code>.ff` for each base (e.g. zone/<language>, usermaps/<map>, or "" for <dir> straight
 * under the root). Community maps ship their .iwd next to the FastFile and a .arena with their display name.
 */
function scanMaps(root: string, bases: string[]): MapEntry[] {
  const maps = new Map<string, MapEntry>()
  for (const base of bases) {
    const top = join(root, base)
    for (const dir of existsSync(top) ? readdirSync(top) : []) {
      if (dir.startsWith('.') || !isDir(join(top, dir))) continue
      const files = readdirSync(join(top, dir))
      const rel = (f: string) => [base, dir, f].filter(Boolean).join('/')
      for (const f of files) {
        const code = MAP.exec(f)?.[1]?.toLowerCase()
        if (!code || code.endsWith('_load') || maps.has(code)) continue
        const arena = files.includes(`mp_${code}.arena`) ? readFileSync(join(top, dir, `mp_${code}.arena`), 'latin1') : ''
        const community = base !== 'zone'
        maps.set(code, {
          code, size: statSync(join(top, dir, f)).size, path: rel(f), name: /longname\s+"([^"]*)"/i.exec(arena)?.[1],
          iwd: community ? files.filter(n => n.endsWith('.iwd') && !n.startsWith('.')).map(rel) : [],
        })
      }
    }
  }
  return [...maps.values()].sort((a, b) => a.code.localeCompare(b.code))
}

const json = (res: ServerResponse, value: unknown) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)) }

/** Serves a file with HTTP Range support (the archives are read by slices). */
function sendFile(req: IncomingMessage, res: ServerResponse, file: string) {
  const size = statSync(file).size
  res.setHeader('Content-Type', 'application/octet-stream')
  res.setHeader('Accept-Ranges', 'bytes')
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '')
  if (range) {
    const start = Number(range[1]), end = Math.min(range[2] ? Number(range[2]) : size - 1, size - 1)
    if (start > end) { res.statusCode = 416; res.setHeader('Content-Range', `bytes */${size}`); return res.end() }
    res.statusCode = 206
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
    res.setHeader('Content-Length', end - start + 1)
    if (req.method === 'HEAD') return res.end()
    createReadStream(file, { start, end }).pipe(res)
    return
  }
  res.setHeader('Content-Length', size)
  if (req.method === 'HEAD') return res.end()
  createReadStream(file).pipe(res)
}

/** Resolves a request path under `root`, only for the given file types (never outside the folder). */
function resolveUnder(root: string, url: string | undefined, types: RegExp): string | null {
  const rel = normalize(decodeURIComponent((url ?? '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '')
  const file = join(root, rel)
  if (!types.test(file) || !existsSync(file)) return null
  // real paths: a symlink inside the folder must not lead out of it
  const real = realpathSync(file), base = realpathSync(root)
  return real.startsWith(base + sep) ? real : null
}

/**
 * Optional access control for a private instance: with MWTHREE_PASSWORD set, every request (page, maps, shared folder) needs
 * HTTP Basic credentials with that password (any user name, unless MWTHREE_USER is set: then that exact name). Unlike a script on the page, it protects the files themselves.
 * Meant for `vite preview` (and dev); a static host such as GitHub Pages cannot do this.
 */
function accessPassword(): Plugin {
  // MWTHREE_PASSWORD_FILE (e.g. a Docker secret) keeps the password out of `docker inspect`
  const file = process.env.MWTHREE_PASSWORD_FILE
  const password = file ? readFileSync(file, 'utf8').trim() : process.env.MWTHREE_PASSWORD
  const digest = (v: string) => createHash('sha256').update(v).digest()
  // a user name alone would protect nothing: fail loudly instead of serving the site open
  if (process.env.MWTHREE_USER && !password) throw new Error('MWTHREE_USER is set without MWTHREE_PASSWORD (or MWTHREE_PASSWORD_FILE): refusing to start')
  const install = (middlewares: Connect.Server) => {
    if (!password) return
    const expected = digest(password)
    const expectedUser = process.env.MWTHREE_USER ? digest(process.env.MWTHREE_USER) : null
    // after 5 wrong passwords an address is refused for a minute (in memory, per address)
    const failures = new Map<string, { count: number; until: number }>()
    middlewares.use((req, res, next) => {
      const ip = req.socket.remoteAddress ?? '', f = failures.get(ip)
      if (f && f.count >= 5 && Date.now() < f.until) { res.statusCode = 429; res.setHeader('Retry-After', '60'); return res.end('Too many attempts') }
      const header = req.headers.authorization ?? ''
      const decoded = header.startsWith('Basic ') ? Buffer.from(header.slice(6), 'base64').toString() : null
      const colon = decoded?.indexOf(':') ?? -1
      const given = decoded !== null && colon >= 0 ? decoded.slice(colon + 1) : null
      // both comparisons always run (no early exit on the user name); without MWTHREE_USER any name is accepted
      const userOk = expectedUser === null || timingSafeEqual(digest(decoded?.slice(0, colon) ?? ''), expectedUser)
      const passOk = given !== null && timingSafeEqual(digest(given), expected)
      if (userOk && passOk) { failures.delete(ip); return next() }
      if (given !== null) failures.set(ip, { count: (f && Date.now() < f.until ? f.count : 0) + 1, until: Date.now() + 60_000 })
      res.statusCode = 401
      res.setHeader('WWW-Authenticate', 'Basic realm="MWThree", charset="UTF-8"')
      res.end('Authentication required')
    })
  }
  return {
    name: 'access-password',
    configureServer: server => install(server.middlewares),
    configurePreviewServer: server => install(server.middlewares),
  }
}

/**
 * Content-Security-Policy of the built app (`vite preview` only: the dev server needs inline scripts for hot reload).
 * Everything is same-origin except Google Fonts; blob: is for the decoded menu images and the workers' data; 'wasm-unsafe-eval'
 * is for Rapier's WebAssembly (no JavaScript eval). Inline styles are React's style attributes.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self' blob: data:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ')

/** Basic hardening headers for everything the server sends (plus the CSP for the built app). */
function securityHeaders(): Plugin {
  const install = (middlewares: Connect.Server, csp = false) => { middlewares.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()')
    if (csp) res.setHeader('Content-Security-Policy', CSP)
    next()
  }) }
  return { name: 'security-headers', configureServer: s => install(s.middlewares), configurePreviewServer: s => install(s.middlewares, true) }
}

/**
 * The maps shipped with the project (`maps/`, community maps redistributed with their authors' permission): served at /maps/
 * with a manifest in dev and `vite preview`, and copied into the build, so any static host serves them too.
 */
function bundledMaps(): Plugin {
  const root = process.env.MWTHREE_BUNDLED ?? join(__dirname, '..', '..', 'maps')
  const manifest = () => scanMaps(root, [''])
  const install = (middlewares: Connect.Server) => {
    middlewares.use('/maps/manifest.json', (_req, res) => json(res, manifest()))
    middlewares.use('/maps', (req, res, next) => {
      const file = resolveUnder(root, req.url, /\.(ff|iwd)$/i)
      if (!file) return next()
      sendFile(req, res, file)
    })
  }
  return {
    name: 'bundled-maps',
    configureServer: server => install(server.middlewares),
    generateBundle() {
      // Shipped under a .zip name: static hosts (GitHub Pages) gzip unknown types such as .iwd/.ff when the browser accepts it, which
      // changes Content-Length and breaks the range reads of the archives; already-compressed types are left alone.
      const entries = manifest().map(e => ({ ...e, path: `${e.path}.zip`, iwd: e.iwd.map(p => `${p}.zip`) }))
      this.emitFile({ type: 'asset', fileName: 'maps/manifest.json', source: JSON.stringify(entries) })
      for (const e of manifest()) for (const rel of [e.path, ...e.iwd]) {
        this.emitFile({ type: 'asset', fileName: `maps/${rel}.zip`, source: readFileSync(join(root, rel)) })
      }
    },
  }
}

/**
 * Optional extra folder, shared on the machine that runs the server (dev and `vite preview`): `inputs/` (never committed) or
 * $MWTHREE_INPUTS, e.g. an MW3 installation. Maps in zone/<code>/ or zone/<language>/, community maps in usermaps/<code>/, base
 * game archives in main/*.iwd. /__inputs-list/maps lists the maps, /__inputs-list/main the archives, /__inputs/ serves them.
 * A static build has none of it.
 */
function localInputs(): Plugin {
  const root = process.env.MWTHREE_INPUTS ?? join(__dirname, '..', '..', 'inputs')
  const install = (middlewares: Connect.Server) => {
    middlewares.use('/__inputs-list/main', (_req, res) => {
      json(res, existsSync(join(root, 'main')) ? readdirSync(join(root, 'main')).filter(n => n.endsWith('.iwd') && !n.startsWith('._')) : [])
    })
    middlewares.use('/__inputs-list/maps', (_req, res) => json(res, scanMaps(root, ['zone', 'usermaps'])))
    middlewares.use('/__inputs', (req, res, next) => {
      const file = resolveUnder(root, req.url, /\.(ff|iwd)$/i)
      if (!file) return next()
      sendFile(req, res, file)
    })
  }
  return {
    name: 'local-inputs',
    configureServer: server => install(server.middlewares),
    configurePreviewServer: server => install(server.middlewares),
  }
}

export default defineConfig({
  // under a sub-path (GitHub Pages: /<repository>/), set VITE_BASE=/<repository>/ when building
  base: process.env.VITE_BASE ?? '/',
  plugins: [react(), securityHeaders(), accessPassword(), bundledMaps(), localInputs()],
  // hostnames `vite preview` accepts besides localhost, comma-separated (e.g. the public name behind a tunnel or reverse proxy)
  preview: { allowedHosts: process.env.MWTHREE_ALLOWED_HOSTS?.split(',').map(h => h.trim()).filter(Boolean) },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
})
