// High-level extraction of renderable / simulatable data from a loaded zone.
import type { LoadedZone } from './ZoneLoader.js'
import { PlainArray } from './ZoneLoader.js'

/** Inches (game units) to meters. */
export const UNIT_SCALE = 0.0254

/** MW3 entity string key ids (observed in retail zones). */
export const ENTITY_KEYS: Record<number, string> = {
  1668: 'classname', 1669: 'origin', 1670: 'model', 1671: 'spawnflags', 1672: 'target',
  1673: 'targetname', 1677: 'angles', 11848: 'script_gameobjectname', 1774: 'script_noteworthy',
}

export type Entity = Record<string, string>

export function parseEntities(entityString: ArrayLike<number>): Entity[] {
  let txt = ''
  const chunk = 8192
  for (let i = 0; i < entityString.length; i += chunk) {
    txt += String.fromCharCode(...Array.from({ length: Math.min(chunk, entityString.length - i) }, (_, k) => entityString[i + k] & 0xff))
  }
  const ents: Entity[] = []
  for (const block of txt.split('}')) {
    const e: Entity = {}
    for (const m of block.matchAll(/(\d+) "([^"]*)"/g)) e[ENTITY_KEYS[Number(m[1])] ?? `key_${m[1]}`] = m[2]
    if (Object.keys(e).length) ents.push(e)
  }
  return ents
}

export function parseVec3(s: string | undefined): [number, number, number] | null {
  if (!s) return null
  const p = s.trim().split(/\s+/).map(Number)
  return p.length >= 3 && p.every(Number.isFinite) ? [p[0], p[1], p[2]] : null
}

export interface WorldMesh {
  /** meters, Y-up (x, z, -y of the game's Z-up) */
  positions: Float32Array
  normals: Float32Array
  uvs: Float32Array
  /** per-vertex debug color derived from the material name */
  colors: Float32Array
  indices: Uint32Array
  /** one entry per drawn surface, in index order */
  surfaces: { material: string; indexStart: number; indexCount: number }[]
  skippedSurfaces: number
}

const HIDDEN_MATERIAL = /(^|\/)(sky|clip|trigger|nodraw|caulk|portal|hint|origin|skip|tools?)(_|$|\/)/i

function materialName(zone: LoadedZone, mat: any): string {
  if (!mat) return ''
  if (mat.$ref !== undefined) { const r = zone.resolveRef(mat.$ref); mat = r?.value }
  return mat?.info?.name ?? ''
}

function resolveVal(zone: LoadedZone, v: any): any {
  if (v && v.$ref !== undefined) return zone.resolveRef(v.$ref)?.value
  return v
}

/** Stable pleasant-ish debug color for a material name. */
function materialColor(name: string): [number, number, number] {
  let h = 2166136261
  for (let i = 0; i < name.length; i++) { h ^= name.charCodeAt(i); h = Math.imul(h, 16777619) }
  const hue = (h >>> 0) % 360, sat = 0.25 + (((h >>> 9) & 0xff) / 255) * 0.25, lum = 0.5 + (((h >>> 17) & 0xff) / 255) * 0.2
  const c = (1 - Math.abs(2 * lum - 1)) * sat, x = c * (1 - Math.abs(((hue / 60) % 2) - 1)), m = lum - c / 2
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x]
  return [r + m, g + m, b + m]
}

function unpackUnitVec(p: number): [number, number, number] {
  // PackedUnitVec: 4 bytes, xyz as unsigned bytes with a shared exponent-ish scale (id Tech 3 style)
  const x = ((p & 0xff) - 127) / 127, y = (((p >>> 8) & 0xff) - 127) / 127, z = (((p >>> 16) & 0xff) - 127) / 127
  const l = Math.hypot(x, y, z) || 1
  return [x / l, y / l, z / l]
}

export function extractWorldMesh(zone: LoadedZone): WorldMesh | null {
  const gfx = zone.assets.find(a => a.typeName === 'GfxWorld')?.value
  if (!gfx) return null
  const verts = gfx.draw.vd.vertices as PlainArray
  const srcIdx = gfx.draw.indices as Uint16Array
  const surfaces = gfx.dpvs.surfaces as any[]
  const vcount = verts.length
  const dv = new DataView(verts.bytes.buffer, verts.bytes.byteOffset, verts.bytes.byteLength)
  const stride = verts.stride // 44
  const positions = new Float32Array(vcount * 3)
  const normals = new Float32Array(vcount * 3)
  const uvs = new Float32Array(vcount * 2)
  const colors = new Float32Array(vcount * 3).fill(0.6)
  for (let i = 0; i < vcount; i++) {
    const o = i * stride
    const x = dv.getFloat32(o, true), y = dv.getFloat32(o + 4, true), z = dv.getFloat32(o + 8, true)
    positions[i * 3] = x * UNIT_SCALE; positions[i * 3 + 1] = z * UNIT_SCALE; positions[i * 3 + 2] = -y * UNIT_SCALE
    uvs[i * 2] = dv.getFloat32(o + 20, true); uvs[i * 2 + 1] = dv.getFloat32(o + 24, true)
    const n = unpackUnitVec(dv.getUint32(o + 36, true))
    normals[i * 3] = n[0]; normals[i * 3 + 1] = n[2]; normals[i * 3 + 2] = -n[1]
  }
  const idx: number[] = []
  const drawn: WorldMesh['surfaces'] = []
  let skipped = 0
  for (const s of surfaces) {
    const name = materialName(zone, s.material)
    if (HIDDEN_MATERIAL.test(name)) { skipped++; continue }
    const { firstVertex, triCount, baseIndex, vertexCount } = s.tris
    const [cr, cg, cb] = materialColor(name)
    for (let v = firstVertex; v < firstVertex + vertexCount && v < vcount; v++) { colors[v * 3] = cr; colors[v * 3 + 1] = cg; colors[v * 3 + 2] = cb }
    const start = idx.length
    // game triangles are clockwise; swap two vertices so front faces are counter-clockwise (three.js)
    for (let k = 0; k < triCount * 3; k += 3) {
      idx.push(firstVertex + srcIdx[baseIndex + k], firstVertex + srcIdx[baseIndex + k + 2], firstVertex + srcIdx[baseIndex + k + 1])
    }
    drawn.push({ material: name, indexStart: start, indexCount: triCount * 3 })
  }
  return { positions, normals, uvs, colors, indices: Uint32Array.from(idx), surfaces: drawn, skippedSurfaces: skipped }
}

export interface MapSummary {
  name: string
  entities: Entity[]
  spawns: { classname: string; origin: [number, number, number]; angles: [number, number, number] }[]
}

export function extractMapEnts(zone: LoadedZone): Entity[] {
  const clip = zone.assets.find(a => a.typeName === 'clipMap_t')?.value
  const me = resolveVal(zone, clip?.mapEnts) ?? zone.assets.find(a => a.typeName === 'MapEnts')?.value
  if (!me?.entityString || typeof me.entityString === 'string') return []
  return parseEntities(me.entityString as ArrayLike<number>)
}
