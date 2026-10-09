// clipMap_t brushes (+ terrain triangles) -> a single triangle mesh for player physics.
import type { LoadedZone } from './ZoneLoader.js'
import { PlainArray } from './ZoneLoader.js'
import { UNIT_SCALE } from './MapExtract.js'
import { convexFaces, type Plane } from './Convex.js'

const CONTENTS_SOLID = 0x1
const CONTENTS_PLAYERCLIP = 0x10000

export interface CollisionMesh {
  /** meters, Y-up */
  positions: Float32Array
  indices: Uint32Array
  brushCount: number
  triCount: number
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
  // Static models (clipMap.staticModelList) are not part of it: the engine only tests them with point traces
  // (bullets, sight; KisakCOD sv_world.cpp), never with the player's box; maps clip them with brushes where needed.
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx), brushCount: used, triCount: tris }
}
