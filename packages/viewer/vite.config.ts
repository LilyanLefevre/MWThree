import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs'
import { join, normalize } from 'node:path'
import type { ServerResponse } from 'node:http'
import { defineConfig, type Connect, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Serve the game files at /__inputs/, in dev and in `vite preview`: the machine that runs the server shares its own
 * maps on the local network. A static build has none of it. The folder is `inputs/` (never committed) or
 * $MWTHREE_INPUTS, e.g. an MW3 installation: maps in zone/<code>/mp_<code>.ff or zone/<language>/mp_<code>.ff,
 * archives in main/*.iwd.
 * /__inputs-list/maps lists the maps ({ code, size, path }), /__inputs-list/main the .iwd archives.
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
      const zone = join(root, 'zone')
      const maps = new Map<string, { code: string; size: number; path: string }>()
      for (const dir of existsSync(zone) ? readdirSync(zone) : []) {
        if (dir.startsWith('.') || !statSync(join(zone, dir)).isDirectory()) continue
        for (const f of readdirSync(join(zone, dir))) {
          const code = MAP.exec(f)?.[1]?.toLowerCase()
          if (!code || code.endsWith('_load') || maps.has(code)) continue
          maps.set(code, { code, size: statSync(join(zone, dir, f)).size, path: `zone/${dir}/${f}` })
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
