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

export interface MaterialGroup { material: string; start: number; count: number }

export interface WorldMesh {
  /** meters, Y-up (x, z, -y of the game's Z-up) */
  positions: Float32Array
  normals: Float32Array
  uvs: Float32Array
  /** per-vertex debug color derived from the material name */
  colors: Float32Array
  indices: Uint32Array
  /** one entry per drawn surface */
  surfaces: { material: string; indexCount: number }[]
  /** index ranges per material, for multi-material rendering */
  groups: MaterialGroup[]
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
export function materialColor(name: string): [number, number, number] {
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
  const byMaterial = new Map<string, number[]>()
  const drawn: WorldMesh['surfaces'] = []
  let skipped = 0
  for (const s of surfaces) {
    const name = materialName(zone, s.material)
    if (HIDDEN_MATERIAL.test(name)) { skipped++; continue }
    const { firstVertex, triCount, baseIndex, vertexCount } = s.tris
    const [cr, cg, cb] = materialColor(name)
    for (let v = firstVertex; v < firstVertex + vertexCount && v < vcount; v++) { colors[v * 3] = cr; colors[v * 3 + 1] = cg; colors[v * 3 + 2] = cb }
    let idx = byMaterial.get(name)
    if (!idx) byMaterial.set(name, idx = [])
    // game triangles are clockwise; swap two vertices so front faces are counter-clockwise (three.js)
    for (let k = 0; k < triCount * 3; k += 3) {
      idx.push(firstVertex + srcIdx[baseIndex + k], firstVertex + srcIdx[baseIndex + k + 2], firstVertex + srcIdx[baseIndex + k + 1])
    }
    drawn.push({ material: name, indexCount: triCount * 3 })
  }
  const groups: MaterialGroup[] = []
  const all: number[] = []
  for (const [material, list] of byMaterial) {
    groups.push({ material, start: all.length, count: list.length })
    for (let i = 0; i < list.length; i++) all.push(list[i])
  }
  return { positions, normals, uvs, colors, indices: Uint32Array.from(all), surfaces: drawn, groups, skippedSurfaces: skipped }
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

// ---------------------------------------------------------------- static models

export interface StaticModelBatch {
  name: string
  /** meters, game axes (the instance matrix converts to scene space) */
  positions: Float32Array
  normals: Float32Array
  uvs: Float32Array
  colors: Float32Array
  indices: Uint32Array
  /** index ranges per material */
  groups: MaterialGroup[]
  /** 16 floats (column-major, scene space) per instance */
  matrices: Float32Array
}

function halfToFloat(h: number): number {
  const e = (h >> 10) & 0x1f, m = h & 0x3ff, sign = h & 0x8000 ? -1 : 1
  if (e === 0) return sign * 2 ** -14 * (m / 1024)
  if (e === 31) return m ? NaN : sign * Infinity
  return sign * 2 ** (e - 15) * (1 + m / 1024)
}

/** LOD0 geometry of one XModel, in meters with the game's axes. */
function buildModelGeometry(zone: LoadedZone, model: any): Omit<StaticModelBatch, 'name' | 'matrices'> | null {
  const lod = model.lodInfo?.[0]
  const surfsAsset = resolveVal(zone, lod?.modelSurfs)
  const surfs: any[] | undefined = surfsAsset?.surfs
  if (!surfs?.length) return null
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = []
  const groups: MaterialGroup[] = []
  const handles: any[] = model.materialHandles ?? []
  surfs.forEach((surf, si) => {
    const verts = surf.verts0 as PlainArray | undefined
    const tris = surf.triIndices as PlainArray | undefined
    if (!verts || !tris || !surf.vertCount || !surf.triCount) return
    const vdv = new DataView(verts.bytes.buffer, verts.bytes.byteOffset, verts.bytes.byteLength)
    const matName = materialName(zone, handles[(lod.surfIndex ?? 0) + si])
    const [cr, cg, cb] = materialColor(matName)
    const idxStart = idx.length
    const base = pos.length / 3
    for (let i = 0; i < verts.length; i++) {
      const o = i * verts.stride
      pos.push(vdv.getFloat32(o, true) * UNIT_SCALE, vdv.getFloat32(o + 4, true) * UNIT_SCALE, vdv.getFloat32(o + 8, true) * UNIT_SCALE)
      const n = unpackUnitVec(vdv.getUint32(o + 24, true))
      nrm.push(n[0], n[1], n[2])
      const t = vdv.getUint32(o + 20, true)
      uv.push(halfToFloat(t & 0xffff), halfToFloat(t >>> 16))
      col.push(cr, cg, cb)
    }
    const tdv = new DataView(tris.bytes.buffer, tris.bytes.byteOffset, tris.bytes.byteLength)
    for (let t = 0; t < surf.triCount; t++) {
      const a = tdv.getUint16(t * 6, true), b = tdv.getUint16(t * 6 + 2, true), c = tdv.getUint16(t * 6 + 4, true)
      idx.push(base + a, base + c, base + b) // game triangles are clockwise
    }
    groups.push({ material: matName, start: idxStart, count: idx.length - idxStart })
  })
  if (!idx.length) return null
  return { positions: Float32Array.from(pos), normals: Float32Array.from(nrm), uvs: Float32Array.from(uv), colors: Float32Array.from(col), indices: Uint32Array.from(idx), groups }
}

/** Static props placed in the world (GfxWorld.dpvs.smodelDrawInsts), grouped per model for instancing. */
export function extractStaticModels(zone: LoadedZone): StaticModelBatch[] {
  const gfx = zone.assets.find(a => a.typeName === 'GfxWorld')?.value
  const insts: any[] = gfx?.dpvs?.smodelDrawInsts ?? []
  const byModel = new Map<any, { model: any; mats: number[] }>()
  for (const inst of insts) {
    const model = resolveVal(zone, inst.model)
    if (!model?.lodInfo) continue
    const { origin, axis, scale } = inst.placement
    const s = scale || 1
    // scene = (x, z, -y); linear part columns are the (scaled) axis vectors converted to scene space
    const col = (k: number) => [axis[k * 3] * s, axis[k * 3 + 2] * s, -axis[k * 3 + 1] * s]
    const [c0, c1, c2] = [col(0), col(1), col(2)]
    const m = [...c0, 0, ...c1, 0, ...c2, 0, origin[0] * UNIT_SCALE, origin[2] * UNIT_SCALE, -origin[1] * UNIT_SCALE, 1]
    const e = byModel.get(model) ?? { model, mats: [] }
    e.mats.push(...m)
    byModel.set(model, e)
  }
  const out: StaticModelBatch[] = []
  for (const { model, mats } of byModel.values()) {
    const g = buildModelGeometry(zone, model)
    if (g) out.push({ name: model.name ?? '', ...g, matrices: Float32Array.from(mats) })
  }
  return out
}

// ---------------------------------------------------------------- materials

const TS_COLOR_MAP = 2

/** Name of the color-map image of a Material (null when it has none). */
function colorImageName(zone: LoadedZone, mat: any): string | null {
  mat = resolveVal(zone, mat)
  const table: any[] | undefined = mat?.textureTable
  if (!table?.length) return null
  const def = table.find(t => t.semantic === TS_COLOR_MAP)
  const img = resolveVal(zone, def?.u?.image)
  return typeof img?.name === 'string' ? img.name : null
}

/** material name -> color-map image name, for every material drawn by the world and its static models. */
export function extractMaterialImages(zone: LoadedZone): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  const add = (mat: any) => {
    const name = materialName(zone, mat)
    if (name && !(name in out)) out[name] = colorImageName(zone, mat)
  }
  const gfx = zone.assets.find(a => a.typeName === 'GfxWorld')?.value
  for (const s of gfx?.dpvs?.surfaces ?? []) add(s.material)
  const seen = new Set<any>()
  for (const inst of gfx?.dpvs?.smodelDrawInsts ?? []) {
    const model = resolveVal(zone, inst.model)
    if (!model || seen.has(model)) continue
    seen.add(model)
    for (const h of model.materialHandles ?? []) add(h)
  }
  return out
}
