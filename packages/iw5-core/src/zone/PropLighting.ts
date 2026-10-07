// Approximate the engine's light probes for props: sample the world lightmap right below each instance.
import type { Lightmap, StaticModelBatch, WorldMesh } from './MapExtract.js'

const CELL = 2 // meters, horizontal grid cell
const LIT_REFERENCE = 205 // lightmap value of a sunlit surface, mapped to 1.0

/** Uniform XZ grid over the world triangles that face up, for vertical ray casts. */
class DownRayGrid {
  private cells = new Map<number, number[]>()
  constructor(private mesh: WorldMesh, triLightmap: Int16Array) {
    const p = mesh.positions, idx = mesh.indices
    for (let t = 0; t < idx.length / 3; t++) {
      if (triLightmap[t] < 0) continue
      const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3
      // keep floors only (normal.y > 0.3)
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2]
      const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2]
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
      if (ny <= 0.3 * Math.hypot(nx, ny, nz)) continue
      const x0 = Math.floor(Math.min(p[a], p[b], p[c]) / CELL), x1 = Math.floor(Math.max(p[a], p[b], p[c]) / CELL)
      const z0 = Math.floor(Math.min(p[a + 2], p[b + 2], p[c + 2]) / CELL), z1 = Math.floor(Math.max(p[a + 2], p[b + 2], p[c + 2]) / CELL)
      if ((x1 - x0 + 1) * (z1 - z0 + 1) > 400) continue // huge background triangles
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
        const k = x * 73856093 ^ z * 19349663
        let list = this.cells.get(k)
        if (!list) this.cells.set(k, list = [])
        list.push(t)
      }
    }
  }

  /** Highest up-facing triangle below (x, y, z): returns triangle index and barycentrics. */
  castDown(x: number, y: number, z: number): { tri: number; u: number; v: number } | null {
    const list = this.cells.get(Math.floor(x / CELL) * 73856093 ^ Math.floor(z / CELL) * 19349663)
    if (!list) return null
    const p = this.mesh.positions, idx = this.mesh.indices
    let best: { tri: number; u: number; v: number } | null = null
    let bestY = -Infinity
    for (const t of list) {
      const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3
      // 2D barycentrics in XZ
      const d = (p[b + 2] - p[c + 2]) * (p[a] - p[c]) + (p[c] - p[b]) * (p[a + 2] - p[c + 2])
      if (Math.abs(d) < 1e-9) continue
      const u = ((p[b + 2] - p[c + 2]) * (x - p[c]) + (p[c] - p[b]) * (z - p[c + 2])) / d
      const v = ((p[c + 2] - p[a + 2]) * (x - p[c]) + (p[a] - p[c]) * (z - p[c + 2])) / d
      const w = 1 - u - v
      if (u < -1e-4 || v < -1e-4 || w < -1e-4) continue
      const hy = u * p[a + 1] + v * p[b + 1] + w * p[c + 1]
      if (hy > y || hy <= bestY) continue
      bestY = hy
      best = { tri: t, u, v }
    }
    return best
  }
}

/**
 * One RGB multiplier per instance (in batch order), taken from the lightmap of the floor under it.
 * Instances with nothing lightmapped below keep 1.0.
 */
export function computePropLighting(mesh: WorldMesh, lightmaps: Lightmap[], batches: StaticModelBatch[]): Float32Array[] {
  const triLightmap = new Int16Array(mesh.indices.length / 3).fill(-1)
  for (const g of mesh.groups) {
    if (g.decal || g.lightmap === undefined || g.lightmap < 0) continue
    triLightmap.fill(g.lightmap, g.start / 3, (g.start + g.count) / 3)
  }
  const grid = new DownRayGrid(mesh, triLightmap)
  const uv = mesh.lmUvs, idx = mesh.indices
  return batches.map(batch => {
    const n = batch.matrices.length / 16
    const out = new Float32Array(n * 3).fill(1)
    for (let i = 0; i < n; i++) {
      const m = batch.matrices
      const x = m[i * 16 + 12], y = m[i * 16 + 13] + 0.25, z = m[i * 16 + 14]
      const hit = grid.castDown(x, y, z)
      if (!hit) continue
      const lm = lightmaps[triLightmap[hit.tri]]
      if (!lm) continue
      const a = idx[hit.tri * 3], b = idx[hit.tri * 3 + 1], c = idx[hit.tri * 3 + 2]
      const w = 1 - hit.u - hit.v
      const s = hit.u * uv[a * 2] + hit.v * uv[b * 2] + w * uv[c * 2]
      const t = hit.u * uv[a * 2 + 1] + hit.v * uv[b * 2 + 1] + w * uv[c * 2 + 1]
      const px = Math.min(lm.width - 1, Math.max(0, Math.floor(s * lm.width)))
      const py = Math.min(lm.height - 1, Math.max(0, Math.floor(t * lm.height)))
      const o = (py * lm.width + px) * 4
      for (let k = 0; k < 3; k++) out[i * 3 + k] = Math.min(1.25, lm.rgba[o + k] / LIT_REFERENCE)
    }
    return out
  })
}
