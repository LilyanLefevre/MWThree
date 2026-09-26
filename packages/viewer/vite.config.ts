import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, normalize } from 'node:path'
import type { ServerResponse } from 'node:http'
import { defineConfig, type Connect, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Serve the game files at /__inputs/, in dev and in `vite preview`: the machine that runs the server shares its own
 * maps on the local network. A static build has none of it. The folder is `inputs/` (never committed) or
 * $MWTHREE_INPUTS, e.g. an MW3 installation: maps in zone/<code>/mp_<code>.ff or zone/<language>/mp_<code>.ff,
 * community maps in usermaps/<code>/, archives in main/*.iwd.
 * /__inputs-list/maps lists the maps ({ code, name, size, path, iwd }), /__inputs-list/main the .iwd archives.
 */
function localInputs(): Plugin {
  const root = process.env.MWTHREE_INPUTS ?? join(__dirname, '..', '..', 'inputs')
  const MAP = /^mp_([a-z0-9_]+)\.ff$/i
  const json = (res: ServerResponse, value: unknown) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)) }
  const install = (middlewares: Connect.Server) => {
    middlewares.use('/__inputs-list/main', (_req, res) => {
      json(res, existsSync(join(root, 'main')) ? readdirSync(join(root, 'main')).filter(n => n.endsWith('.iwd') && !n.startsWith('._')) : [])
    })
    middlewares.use('/__inputs-list/maps', (_req, res) => {
      type Entry = { code: string; name?: string; size: number; path: string; iwd: string[] }
      const maps = new Map<string, Entry>()
      const isDir = (p: string) => { try { return statSync(p).isDirectory() } catch { return false } }
      // retail layout: zone/<map or language>/mp_<map>.ff; community maps: usermaps/<map>/mp_<map>.ff (+ .iwd, .arena)
      for (const base of ['zone', 'usermaps']) {
        const top = join(root, base)
        for (const dir of existsSync(top) ? readdirSync(top) : []) {
          if (dir.startsWith('.') || !isDir(join(top, dir))) continue
          const files = readdirSync(join(top, dir))
          for (const f of files) {
            const code = MAP.exec(f)?.[1]?.toLowerCase()
            if (!code || code.endsWith('_load') || maps.has(code)) continue
            const arena = files.includes(`mp_${code}.arena`) ? readFileSync(join(top, dir, `mp_${code}.arena`), 'latin1') : ''
            maps.set(code, {
              code, size: statSync(join(top, dir, f)).size, path: `${base}/${dir}/${f}`,
              name: /longname\s+"([^"]*)"/i.exec(arena)?.[1],
              iwd: base === 'usermaps' ? files.filter(n => n.endsWith('.iwd') && !n.startsWith('.')).map(n => `${base}/${dir}/${n}`) : [],
            })
          }
        }
      }
      json(res, [...maps.values()].sort((a, b) => a.code.localeCompare(b.code)))
    })
    middlewares.use('/__inputs', (req, res, next) => {
      const rel = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '')
      const file = join(root, rel)
      if (!file.startsWith(root) || !/\.(ff|iwd)$/i.test(file) || !existsSync(file)) return next()
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
    })
  }
  return {
    name: 'local-inputs',
    configureServer: server => install(server.middlewares),
    configurePreviewServer: server => install(server.middlewares),
  }
}

export default defineConfig({
  plugins: [react(), localInputs()],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
})
