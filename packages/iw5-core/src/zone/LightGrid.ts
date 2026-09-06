// Light grid lookup (engine probes for models), after the IW3 renderer (R_LightGridLookup / R_GetLightingAtPoint).
// Cells are 32 × 32 × 64 game units, offset by 2^17 so coordinates stay positive.

export interface LightGridSample {
  /** blended 56 directional samples (surface of a 4×4×4 cube), RGB 0-255, sun excluded */
  colors: Float32Array
  /** 0-1: share of the sample that sees the sun (the engine adds sunColor × weight × 0.5 × 255) */
  sunWeight: number
}

/** byte offset of a GfxLightGridEntry (u16 colorsIndex, u8 primaryLightIndex, u8 needsTrace) in `entries.bytes`; -1 = none */
type Entry = number

/** The 4 entries (col, col+1) × (z, z+1) of grid row `pos[rowAxis]`, or nulls. Mirrors R_GetLightGridSampleEntryQuad. */
function entryQuad(g: any, raw: Uint8Array, pos: number[], out: Entry[], o: number) {
  out[o] = out[o + 1] = out[o + 2] = out[o + 3] = -1
  const ra = g.rowAxis, ca = g.colAxis
  const rowIndex = pos[ra] - g.mins[ra]
  if (rowIndex < 0 || rowIndex > g.maxs[ra] - g.mins[ra] || g.rowDataStart[rowIndex] === 0xffff) return
  const r = g.rowDataStart[rowIndex] * 4
  const u16 = (i: number) => raw[i] | raw[i + 1] << 8
  const colStart = u16(r), colCount = u16(r + 2), zStart = u16(r + 4), zCount = u16(r + 6)
  const firstEntry = (raw[r + 8] | raw[r + 9] << 8 | raw[r + 10] << 16) + raw[r + 11] * 0x1000000
  let col = pos[ca] - colStart
  const z = pos[2] - zStart
  if (col < 0 || col >= colCount || z < 0 || z >= zCount) return
  const wide = zCount > 255 ? 1 : 0
  const baseZ = (p: number) => raw[p + 2] + (wide ? raw[p + 3] << 8 : 0)
  const at = (i: number): Entry => i * 4
  let p = r + 12, first = firstEntry
  while (col >= raw[p]) {
    col -= raw[p]
    first += raw[p] * raw[p + 1]
    p += raw[p + 1] ? 3 + wide : 2
  }
  const pick = (base: number, n: number, lz: number, k: number) => {
    if (lz >= 0 && lz < n) out[o + k] = at(base + lz)
    if (lz + 1 >= 0 && lz + 1 < n) out[o + k + 1] = at(base + lz + 1)
  }
  const n = raw[p + 1]
  if (n) {
    const lz = z - baseZ(p)
    pick(first + col * n, n, lz, 0)
    if (col + 1 < raw[p]) { pick(first + (col + 1) * n, n, lz, 2); return }
  } else if (col + 1 < raw[p]) return
  if (pos[ca] + 1 === colCount + colStart) return
  // next column starts the next run
  const q = p + (n ? 3 + wide : 2)
  pick(first + raw[p] * n, raw[q + 1], z - baseZ(q), 2)
}

/**
 * Lighting at a point in game units. Line-of-sight checks on `needsTrace` corners are skipped.
 * Returns null where the grid has no data.
 */
export function sampleLightGrid(g: any, x: number, y: number, z: number): LightGridSample | null {
  const raw: Uint8Array = g.rawRowData
  const pos = [(Math.floor(x) + 0x20000) >> 5, (Math.floor(y) + 0x20000) >> 5, (Math.floor(z) + 0x20000) >> 6]
  const ra = g.rowAxis, ca = g.colAxis
  const p = [x, y, z]
  const lr = (p[ra] + 131072) / 32 - pos[ra], lc = (p[ca] + 131072) / 32 - pos[ca], lz = (z + 131072) / 64 - pos[2]
  // corner bits: 4 = row + 1, 2 = col + 1, 1 = z + 1
  const weight = (i: number) => (i & 4 ? lr : 1 - lr) * (i & 2 ? lc : 1 - lc) * (i & 1 ? lz : 1 - lz)
  const corners: Entry[] = new Array(8)
  entryQuad(g, raw, pos, corners, 0)
  pos[ra]++
  entryQuad(g, raw, pos, corners, 4)

  const sunIndex = g.lastSunPrimaryLightIndex
  const eb: Uint8Array = g.entries.bytes, cb: Uint8Array = g.colors.bytes
  const colors = new Float32Array(56 * 3)
  let total = 0, sun = 0
  for (let i = 0; i < 8; i++) {
    const e = corners[i], w = weight(i)
    if (e < 0 || w < 1e-6) continue
    total += w
    const light = eb[e + 2]
    if (light === sunIndex || light === 255) sun += w
    const c = (eb[e] | eb[e + 1] << 8) * 168
    for (let k = 0; k < 168; k++) colors[k] += cb[c + k] * w
  }
  if (total === 0) return null
  for (let k = 0; k < 56 * 3; k++) colors[k] /= total
  return { colors, sunWeight: sun / total }
}
