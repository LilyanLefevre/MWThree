import { createReadStream, existsSync, statSync } from 'node:fs'
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
      server.middlewares.use('/__inputs', (req, res, next) => {
        const rel = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '')
        const file = join(root, rel)
        if (!file.startsWith(root) || !/\.(ff|iwd)$/i.test(file) || !existsSync(file)) return next()
        res.setHeader('Content-Length', statSync(file).size)
        res.setHeader('Content-Type', 'application/octet-stream')
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
