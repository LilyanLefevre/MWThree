// clipMap_t brushes (+ terrain triangles) -> a single triangle mesh for physics.
import type { LoadedZone } from './ZoneLoader.js'
import { PlainArray } from './ZoneLoader.js'
import { UNIT_SCALE, buildModelGeometry } from './MapExtract.js'
import { convexFaces, type Plane } from './Convex.js'

const CONTENTS_SOLID = 0x1
const CONTENTS_PLAYERCLIP = 0x10000

export interface CollisionMesh {
  /** meters, Y-up */
  positions: Float32Array
  indices: Uint32Array
  brushCount: number
  triCount: number
  /** static models of the clipMap that were given collision (coarsest LOD of their render mesh) */
  modelCount: number
}

const get = (arr: any, i: number) => (arr instanceof PlainArray ? arr.get(i) : arr[i])

export function extractCollisionMesh(zone: LoadedZone): CollisionMesh | null {
  const clip = zone.assets.find(a => a.typeName === 'clipMap_t')?.value
  if (!clip) return null
  const info = clip.info
  const brushes: any[] = info.brushes ?? []
  const contents = info.brushContents as Int32Array
  const bounds = info.brushBounds
  const pos: number[] = []
  const idx: number[] = []
  const addVert = (x: number, y: number, z: number) => {
    pos.push(x * UNIT_SCALE, z * UNIT_SCALE, -y * UNIT_SCALE)
    return pos.length / 3 - 1
  }
  let used = 0
  brushes.forEach((b, bi) => {
    if (!(contents[bi] & (CONTENTS_SOLID | CONTENTS_PLAYERCLIP))) return
    const ref = b.sides?.$ref !== undefined ? zone.resolveRef(b.sides.$ref) : null
    const sideArr = ref?.array ?? b.sides
    const first = ref?.index ?? 0
    const bb = get(bounds, bi)
    const m = bb.midPoint, h = bb.halfSize
    const planes: Plane[] = [
      [1, 0, 0, m.x + h.x], [-1, 0, 0, -(m.x - h.x)],
      [0, 1, 0, m.y + h.y], [0, -1, 0, -(m.y - h.y)],
      [0, 0, 1, m.z + h.z], [0, 0, -1, -(m.z - h.z)],
    ]
    for (let k = 0; sideArr && k < b.numsides; k++) {
      const sd = get(sideArr, first + k)
      const pr = sd.plane?.$ref !== undefined ? zone.resolveRef(sd.plane.$ref) : null
      const pl = pr ? get(pr.array, pr.index) : sd.plane
      if (pl?.normal) planes.push([pl.normal[0], pl.normal[1], pl.normal[2], pl.dist])
    }
    const faces = convexFaces(planes)
    if (!faces.length) return
    used++
    for (const poly of faces) {
      const ids = poly.map(p => addVert(p[0], p[1], p[2]))
      for (let t = 1; t < ids.length - 1; t++) idx.push(ids[0], ids[t], ids[t + 1])
    }
  })

  // terrain / patch collision triangles
  let tris = 0
  const verts = clip.verts, ti = clip.triIndices as Uint16Array | undefined
  if (verts && ti && clip.triCount) {
    const base = pos.length / 3
    for (let i = 0; i < verts.length; i++) { const v = verts.get(i); addVert(v.x, v.y, v.z) }
    for (let t = 0; t < clip.triCount; t++) idx.push(base + ti[t * 3], base + ti[t * 3 + 1], base + ti[t * 3 + 2])
    tris = clip.triCount
  }
  // static models that collide in game (clipMap.staticModelList): their coarsest render LOD,
  // placed with the inverse of invScaledAxis
  let models = 0
  const geoCache = new Map<any, ReturnType<typeof buildModelGeometry>>()
  for (const sm of clip.staticModelList ?? []) {
    const model = sm.xmodel?.$ref !== undefined ? zone.resolveRef(sm.xmodel.$ref)?.value : sm.xmodel
    if (!model?.lodInfo) continue
    if (!geoCache.has(model)) geoCache.set(model, buildModelGeometry(zone, model, (model.numLods ?? 1) - 1))
    const g = geoCache.get(model)
    if (!g) continue
    const m = invert3(sm.invScaledAxis)
    if (!m) continue
    const o = sm.origin
    const base = pos.length / 3
    for (let i = 0; i < g.positions.length; i += 3) {
      // positions are meters in model axes: convert back to game units for the shared transform
      const x = g.positions[i] / UNIT_SCALE, y = g.positions[i + 1] / UNIT_SCALE, z = g.positions[i + 2] / UNIT_SCALE
      // world = origin + x * axis0 + y * axis1 + z * axis2 (rows of the scaled axis matrix)
      addVert(o[0] + x * m[0] + y * m[3] + z * m[6], o[1] + x * m[1] + y * m[4] + z * m[7], o[2] + x * m[2] + y * m[5] + z * m[8])
    }
    for (const k of g.indices) idx.push(base + k)
    models++
  }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx), brushCount: used, triCount: tris, modelCount: models }
}

/** Inverse of a row-major 3x3 matrix. */
function invert3(a: ArrayLike<number>): number[] | null {
  const [a0, a1, a2, a3, a4, a5, a6, a7, a8] = Array.from(a)
  const c0 = a4 * a8 - a5 * a7, c1 = a5 * a6 - a3 * a8, c2 = a3 * a7 - a4 * a6
  const det = a0 * c0 + a1 * c1 + a2 * c2
  if (Math.abs(det) < 1e-12) return null
  const d = 1 / det
  return [
    c0 * d, (a2 * a7 - a1 * a8) * d, (a1 * a5 - a2 * a4) * d,
    c1 * d, (a0 * a8 - a2 * a6) * d, (a2 * a3 - a0 * a5) * d,
    c2 * d, (a1 * a6 - a0 * a7) * d, (a0 * a4 - a1 * a3) * d,
  ]
}
