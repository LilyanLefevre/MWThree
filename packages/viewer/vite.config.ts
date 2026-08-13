import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/** Dev only: serve the local `inputs/` folder (game files, never committed) at /__inputs/ */
function devInputs(): Plugin {
  const root = join(__dirname, '..', '..', 'inputs')
  return {
    name: 'dev-inputs',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__inputs-list/main', (_req, res) => {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(existsSync(join(root, 'main')) ? readdirSync(join(root, 'main')).filter(n => n.endsWith('.iwd')) : []))
      })
      server.middlewares.use('/__inputs', (req, res, next) => {
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
    },
  }
}

export default defineConfig({
  plugins: [react(), devInputs()],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
})
