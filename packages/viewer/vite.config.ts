import type { IncomingMessage, ServerResponse } from 'node:http'
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, normalize } from 'node:path'
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
  return file.startsWith(root) && types.test(file) && existsSync(file) ? file : null
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
  plugins: [react(), bundledMaps(), localInputs()],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
})
