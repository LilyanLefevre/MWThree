// Prop lighting from the engine's light grid (see LightGrid.ts).
import type { StaticModelBatch } from './MapExtract.js'
import { sampleLightGrid } from './LightGrid.js'

/** Floats per instance: 6 vec4 = ambient cube faces (scene +X, −X, +Y, −Y, +Z, −Z) in RGB 0-1, sun weight in the first .w */
export const PROP_LIGHT_STRIDE = 24

// The 56 samples cover the surface of a 4×4×4 cube indexed (slice = game z, row = game y, col = game x), index 0 = negative side
// (R_SetLightGridColors layout; verified on mp_dome: the +z face is the bluest, the faces turned away from the sun the brightest).
// Each face is the mean of its 4 inner samples.
const FACES = [
  [21, 23, 33, 35], // col 3: game +x = scene +X
  [20, 22, 32, 34], // col 0: scene −X
  [45, 46, 49, 50], // slice 3: game +z = scene +Y
  [5, 6, 9, 10], // slice 0: scene −Y
  [17, 18, 29, 30], // row 0: game −y = scene +Z
  [25, 26, 37, 38], // row 3: scene −Z
]

/**
 * Per instance (in batch order): the light grid sampled at the model's bounds center, as an ambient cube plus the
 * share of the sample that sees the sun. Outside the grid, the engine's fallback: colors[1], fully sunlit.
 */
export function computePropLighting(lightGrid: any, batches: StaticModelBatch[]): Float32Array[] {
  const fallback = lightGrid && lightGrid.colorCount > 1
    ? { colors: Float32Array.from(lightGrid.colors.bytes.subarray(168, 336)), sunWeight: 1 }
    : { colors: new Float32Array(168).fill(128), sunWeight: 1 }
  return batches.map(batch => {
    const n = batch.matrices.length / 16
    const out = new Float32Array(n * PROP_LIGHT_STRIDE)
    // bounds center, model space (meters, game axes)
    const p = batch.positions, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < p.length; i++) { lo[i % 3] = Math.min(lo[i % 3], p[i]); hi[i % 3] = Math.max(hi[i % 3], p[i]) }
    const c = p.length ? lo.map((v, k) => (v + hi[k]) / 2) : [0, 0, 0]
    for (let i = 0; i < n; i++) {
      const m = batch.matrices.subarray(i * 16, i * 16 + 16)
      const sx = m[0] * c[0] + m[4] * c[1] + m[8] * c[2] + m[12]
      const sy = m[1] * c[0] + m[5] * c[1] + m[9] * c[2] + m[13]
      const sz = m[2] * c[0] + m[6] * c[1] + m[10] * c[2] + m[14]
      const s = (lightGrid && sampleLightGrid(lightGrid, sx / 0.0254, -sz / 0.0254, sy / 0.0254)) || fallback
      const o = i * PROP_LIGHT_STRIDE
      FACES.forEach((face, f) => {
        for (let k = 0; k < 3; k++) {
          let v = 0
          for (const j of face) v += s.colors[j * 3 + k]
          out[o + f * 4 + k] = v / 4 / 255
        }
      })
      out[o + 3] = s.sunWeight
    }
    return out
  })
}
