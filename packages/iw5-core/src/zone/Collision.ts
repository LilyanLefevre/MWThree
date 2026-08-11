// clipMap_t brushes (+ terrain triangles) -> a single triangle mesh for physics.
import type { LoadedZone } from './ZoneLoader.js'
import { PlainArray } from './ZoneLoader.js'
import { UNIT_SCALE } from './MapExtract.js'

const CONTENTS_SOLID = 0x1
const CONTENTS_PLAYERCLIP = 0x10000
const EPS = 0.05

export interface CollisionMesh {
  /** meters, Y-up */
  positions: Float32Array
  indices: Uint32Array
  brushCount: number
  triCount: number
}

type Plane = [number, number, number, number] // nx, ny, nz, dist: inside is n·p <= dist

const get = (arr: any, i: number) => (arr instanceof PlainArray ? arr.get(i) : arr[i])

/** Polygon (as vertex list) for each plane of the convex brush defined by `planes`, in game units. */
function brushFaces(planes: Plane[]): number[][][] {
  const n = planes.length
  const pts: number[][] = []
  for (let i = 0; i < n - 2; i++) for (let j = i + 1; j < n - 1; j++) for (let k = j + 1; k < n; k++) {
    const [a, b, c] = [planes[i], planes[j], planes[k]]
    const det = a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])
    if (Math.abs(det) < 1e-6) continue
    const x = (a[3] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[3] * c[2] - b[2] * c[3]) + a[2] * (b[3] * c[1] - b[1] * c[3])) / det
    const y = (a[0] * (b[3] * c[2] - b[2] * c[3]) - a[3] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[3] - b[3] * c[0])) / det
    const z = (a[0] * (b[1] * c[3] - b[3] * c[1]) - a[1] * (b[0] * c[3] - b[3] * c[0]) + a[3] * (b[0] * c[1] - b[1] * c[0])) / det
    let inside = true
    for (let m = 0; m < n && inside; m++) if (planes[m][0] * x + planes[m][1] * y + planes[m][2] * z > planes[m][3] + EPS) inside = false
    if (!inside) continue
    if (!pts.some(p => Math.abs(p[0] - x) < EPS && Math.abs(p[1] - y) < EPS && Math.abs(p[2] - z) < EPS)) pts.push([x, y, z])
  }
  if (pts.length < 4) return []
  const faces: number[][][] = []
  for (const pl of planes) {
    const on = pts.filter(p => Math.abs(pl[0] * p[0] + pl[1] * p[1] + pl[2] * p[2] - pl[3]) < EPS * 2)
    if (on.length < 3) continue
    const cx = on.reduce((s, p) => s + p[0], 0) / on.length, cy = on.reduce((s, p) => s + p[1], 0) / on.length, cz = on.reduce((s, p) => s + p[2], 0) / on.length
    // basis (u, v) on the plane with u x v = n
    const nrm = [pl[0], pl[1], pl[2]]
    const ref = Math.abs(nrm[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]
    let u = [nrm[1] * ref[2] - nrm[2] * ref[1], nrm[2] * ref[0] - nrm[0] * ref[2], nrm[0] * ref[1] - nrm[1] * ref[0]]
    const ul = Math.hypot(u[0], u[1], u[2]) || 1
    u = u.map(c => c / ul)
    const v = [nrm[1] * u[2] - nrm[2] * u[1], nrm[2] * u[0] - nrm[0] * u[2], nrm[0] * u[1] - nrm[1] * u[0]]
    on.sort((p, q) => {
      const ap = Math.atan2((p[0] - cx) * v[0] + (p[1] - cy) * v[1] + (p[2] - cz) * v[2], (p[0] - cx) * u[0] + (p[1] - cy) * u[1] + (p[2] - cz) * u[2])
      const aq = Math.atan2((q[0] - cx) * v[0] + (q[1] - cy) * v[1] + (q[2] - cz) * v[2], (q[0] - cx) * u[0] + (q[1] - cy) * u[1] + (q[2] - cz) * u[2])
      return ap - aq
    })
    faces.push(on)
  }
  return faces
}

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
    const faces = brushFaces(planes)
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
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx), brushCount: used, triCount: tris }
}
