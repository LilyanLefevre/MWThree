// High-level extraction of renderable / simulatable data from a loaded zone.
import type { LoadedZone } from './ZoneLoader.js'
import { PlainArray } from './ZoneLoader.js'
import { convexFaces, type Plane } from './Convex.js'

/** Inches (game units) to meters. */
export const UNIT_SCALE = 0.0254

/** MW3 entity string key ids (observed in retail zones). */
export const ENTITY_KEYS: Record<number, string> = {
  1668: 'classname', 1669: 'origin', 1670: 'model', 1671: 'spawnflags', 1672: 'target',
  1673: 'targetname', 1677: 'angles', 11848: 'script_gameobjectname', 1774: 'script_noteworthy',
  1782: 'radius', 1783: 'height', 11996: 'script_label',
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

export interface MaterialGroup {
  material: string
  start: number
  count: number
  /** blended decal layer (alpha comes from the vertex color) */
  decal?: boolean
  /** index into the lightmap list, or -1 for unlit-by-lightmap surfaces */
  lightmap?: number
}

export interface WorldMesh {
  /** meters, Y-up (x, z, -y of the game's Z-up) */
  positions: Float32Array
  normals: Float32Array
  uvs: Float32Array
  /** lightmap atlas coordinates */
  lmUvs: Float32Array
  /** RGBA vertex color, white with the vertex alpha (used to blend decals) */
  vertexColors: Float32Array
  /** per-vertex debug color derived from the material name */
  colors: Float32Array
  indices: Uint32Array
  /** one entry per drawn surface */
  surfaces: { material: string; indexCount: number }[]
  /** index ranges per material, for multi-material rendering */
  groups: MaterialGroup[]
  skippedSurfaces: number
}

const HIDDEN_MATERIAL = /(^|\/)(sky|clip|trigger|nodraw|caulk|portal|hint|origin|skip|tools?|hdrportal|shadowcaster|atmos_)/i

/** Material.info.sortKey values from this one up (except the shadow-caster key) are blended decal layers. */
const DECAL_SORT_KEY_MIN = 6
const SHADOW_SORT_KEY = 34

function materialName(zone: LoadedZone, mat: any): string {
  if (!mat) return ''
  if (mat.$ref !== undefined) { const r = zone.resolveRef(mat.$ref); mat = r?.value }
  return mat?.info?.name ?? ''
}

function sortKeyOf(zone: LoadedZone, mat: any): number {
  mat = resolveVal(zone, mat)
  return mat?.info?.sortKey ?? 0
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
  const lmUvs = new Float32Array(vcount * 2)
  const vertexColors = new Float32Array(vcount * 4).fill(1)
  const lmCount = (gfx.draw.lightmaps as any[] | undefined)?.length ?? 0
  for (let i = 0; i < vcount; i++) {
    const o = i * stride
    const x = dv.getFloat32(o, true), y = dv.getFloat32(o + 4, true), z = dv.getFloat32(o + 8, true)
    positions[i * 3] = x * UNIT_SCALE; positions[i * 3 + 1] = z * UNIT_SCALE; positions[i * 3 + 2] = -y * UNIT_SCALE
    uvs[i * 2] = dv.getFloat32(o + 20, true); uvs[i * 2 + 1] = dv.getFloat32(o + 24, true)
    vertexColors[i * 4 + 3] = dv.getUint8(o + 19) / 255
    lmUvs[i * 2] = dv.getFloat32(o + 28, true); lmUvs[i * 2 + 1] = dv.getFloat32(o + 32, true)
    const n = unpackUnitVec(dv.getUint32(o + 36, true))
    normals[i * 3] = n[0]; normals[i * 3 + 1] = n[2]; normals[i * 3 + 2] = -n[1]
  }
  const byMaterial = new Map<string, { material: string; lightmap: number; decal: boolean; idx: number[] }>()
  const drawn: WorldMesh['surfaces'] = []
  let skipped = 0
  for (const s of surfaces) {
    const name = materialName(zone, s.material)
    if (HIDDEN_MATERIAL.test(name) || sortKeyOf(zone, s.material) === SHADOW_SORT_KEY) { skipped++; continue }
    const { firstVertex, triCount, baseIndex, vertexCount } = s.tris
    const [cr, cg, cb] = materialColor(name)
    for (let v = firstVertex; v < firstVertex + vertexCount && v < vcount; v++) { colors[v * 3] = cr; colors[v * 3 + 1] = cg; colors[v * 3 + 2] = cb }
    const lmi = s.laf?.fields?.lightmapIndex ?? 255
    const lightmap = lmi < lmCount ? lmi : -1
    const decal = sortKeyOf(zone, s.material) >= DECAL_SORT_KEY_MIN
    const key = `${name}|${lightmap}`
    let entry = byMaterial.get(key)
    if (!entry) byMaterial.set(key, entry = { material: name, lightmap, decal, idx: [] })
    const idx = entry.idx
    // game triangles are clockwise; swap two vertices so front faces are counter-clockwise (three.js)
    for (let k = 0; k < triCount * 3; k += 3) {
      idx.push(firstVertex + srcIdx[baseIndex + k], firstVertex + srcIdx[baseIndex + k + 2], firstVertex + srcIdx[baseIndex + k + 1])
    }
    drawn.push({ material: name, indexCount: triCount * 3 })
  }
  const groups: MaterialGroup[] = []
  const all: number[] = []
  for (const { material, lightmap, decal, idx: list } of byMaterial.values()) {
    groups.push({ material, lightmap, decal, start: all.length, count: list.length })
    for (let i = 0; i < list.length; i++) all.push(list[i])
  }
  return { positions, normals, uvs, lmUvs, vertexColors, colors, indices: Uint32Array.from(all), surfaces: drawn, groups, skippedSurfaces: skipped }
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
  /** coarser level of detail (LOD 1) drawn beyond `farDistance` meters, when the model has one */
  far?: ModelGeometry
  farDistance?: number
}

export type ModelGeometry = Omit<StaticModelBatch, 'name' | 'matrices' | 'far' | 'farDistance'>

function halfToFloat(h: number): number {
  const e = (h >> 10) & 0x1f, m = h & 0x3ff, sign = h & 0x8000 ? -1 : 1
  if (e === 0) return sign * 2 ** -14 * (m / 1024)
  if (e === 31) return m ? NaN : sign * Infinity
  return sign * 2 ** (e - 15) * (1 + m / 1024)
}

/** LOD0 geometry of one XModel, in meters with the game's axes. */
export function buildModelGeometry(zone: LoadedZone, model: any, lodIndex = 0): ModelGeometry | null {
  const lod = model.lodInfo?.[Math.min(lodIndex, Math.max(0, (model.numLods ?? 1) - 1))]
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
    addInstance(byModel, model, origin, axis, scale)
  }
  return batchesOf(zone, byModel)
}

/** Instance matrix: scene = (x, z, -y); the linear part columns are the (scaled) axis vectors converted to scene space. */
function addInstance(byModel: Map<any, { model: any; mats: number[] }>, model: any, origin: ArrayLike<number>, axis: ArrayLike<number>, scale: number) {
  const s = scale || 1
  const col = (k: number) => [axis[k * 3] * s, axis[k * 3 + 2] * s, -axis[k * 3 + 1] * s]
  const [c0, c1, c2] = [col(0), col(1), col(2)]
  const m = [...c0, 0, ...c1, 0, ...c2, 0, origin[0] * UNIT_SCALE, origin[2] * UNIT_SCALE, -origin[1] * UNIT_SCALE, 1]
  const e = byModel.get(model) ?? { model, mats: [] }
  e.mats.push(...m)
  byModel.set(model, e)
}

function batchesOf(zone: LoadedZone, byModel: Map<any, { model: any; mats: number[] }>): StaticModelBatch[] {
  const out: StaticModelBatch[] = []
  for (const { model, mats } of byModel.values()) {
    const g = buildModelGeometry(zone, model)
    if (!g) continue
    const batch: StaticModelBatch = { name: model.name ?? '', ...g, matrices: Float32Array.from(mats) }
    const dist = model.lodInfo?.[0]?.dist
    if ((model.numLods ?? 1) > 1 && dist > 0) {
      const far = buildModelGeometry(zone, model, 1)
      if (far && far.indices.length < g.indices.length) { batch.far = far; batch.farDistance = dist * UNIT_SCALE }
    }
    out.push(batch)
  }
  return out
}

/** Game Euler angles (pitch, yaw, roll in degrees) to the forward/left/up axes, row-major 3x3. */
function anglesToAxis(pitch: number, yaw: number, roll: number): number[] {
  const d = Math.PI / 180
  const [sp, cp, sy, cy, sr, cr] = [Math.sin(pitch * d), Math.cos(pitch * d), Math.sin(yaw * d), Math.cos(yaw * d), Math.sin(roll * d), Math.cos(roll * d)]
  return [
    cp * cy, cp * sy, -sp,
    sr * sp * cy - cr * sy, sr * sp * sy + cr * cy, sr * cp,
    cr * sp * cy + sr * sy, cr * sp * sy - sr * cy, cr * cp,
  ]
}

/** Every XModel reachable from the zone, by name (zone assets, world static models, clipMap static models). */
function modelsByName(zone: LoadedZone): Map<string, any> {
  const out = new Map<string, any>()
  const add = (m: any) => { if (m?.name && m.lodInfo && !out.has(m.name)) out.set(m.name, m) }
  for (const a of zone.assets) if (a.typeName === 'XModel') add(a.value)
  const gfx = zone.assets.find(a => a.typeName === 'GfxWorld')?.value
  for (const i of gfx?.dpvs?.smodelDrawInsts ?? []) add(resolveVal(zone, i.model))
  const clip = zone.assets.find(a => a.typeName === 'clipMap_t')?.value
  for (const s of clip?.staticModelList ?? []) add(resolveVal(zone, s.xmodel))
  return out
}

/**
 * Models placed by entities (script_model: vehicles, crates, destructibles…), drawn in their intact state.
 * Entities whose model is not in the zone are skipped; `missing` lists their names.
 */
export function extractEntityModels(zone: LoadedZone, entities: Entity[]): { batches: StaticModelBatch[]; missing: string[] } {
  const models = modelsByName(zone)
  const byModel = new Map<any, { model: any; mats: number[] }>()
  const missing = new Set<string>()
  for (const e of entities) {
    if (e.classname !== 'script_model' || !e.model || e.model.startsWith('*')) continue
    const origin = parseVec3(e.origin)
    if (!origin) continue
    const model = models.get(e.model)
    if (!model) { missing.add(e.model); continue }
    const [p, y, r] = parseVec3(e.angles) ?? [0, 0, 0]
    addInstance(byModel, model, origin, anglesToAxis(p, y, r), Number(e.modelscale) || 1)
  }
  return { batches: batchesOf(zone, byModel), missing: [...missing] }
}

// ---------------------------------------------------------------- materials

const TS_COLOR_MAP = 2
const TS_NORMAL_MAP = 5

/** Name of the image bound to a Material's texture slot (null when it has none). */
function imageName(zone: LoadedZone, mat: any, semantic: number): string | null {
  mat = resolveVal(zone, mat)
  const table: any[] | undefined = mat?.textureTable
  if (!table?.length) return null
  const def = table.find(t => t.semantic === semantic)
  const img = resolveVal(zone, def?.u?.image)
  return typeof img?.name === 'string' ? img.name : null
}

/** material name -> color-map image name, for every material drawn by the world and its static models. */
/** Same as extractMaterialImages for the normal-map slot. */
export function extractMaterialNormals(zone: LoadedZone): Record<string, string | null> {
  return extractMaterialImages(zone, TS_NORMAL_MAP)
}

export function extractMaterialImages(zone: LoadedZone, semantic = TS_COLOR_MAP): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  const add = (mat: any) => {
    const name = materialName(zone, mat)
    if (name && !(name in out)) out[name] = imageName(zone, mat, semantic)
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

// ---------------------------------------------------------------- lightmaps

export interface Lightmap { width: number; height: number; rgba: Uint8Array }

export interface Sun {
  /** linear RGB, as authored (can exceed 1) */
  color: [number, number, number]
  /** unit vector toward the sun, scene space (Y up) */
  direction: [number, number, number]
}

/** The map's sun: the last sun-type primary light of the ComWorld. */
export function extractSun(zone: LoadedZone): Sun | null {
  const gfx = zone.assets.find(a => a.typeName === 'GfxWorld')?.value
  const com = zone.assets.find(a => a.typeName === 'ComWorld')?.value
  const lights: any[] = com?.primaryLights ?? []
  const i = Math.min(gfx?.lastSunPrimaryLightIndex ?? 1, lights.length - 1)
  const l = lights[i]
  if (!l || !l.color || (l.color[0] + l.color[1] + l.color[2]) <= 0) return null
  const [x, y, z] = [l.dir[0], l.dir[1], l.dir[2]]
  const n = Math.hypot(x, y, z) || 1
  return { color: [l.color[0], l.color[1], l.color[2]], direction: [x / n, z / n, -y / n] }
}

/**
 * Each lightmap pair as one RGBA image at the primary's resolution, following the engine's lightmap shaders
 * (IW4 `lm_sun_*`, same layout in IW5):
 * - secondary (A8R8G8B8, half the primary's size) holds two stacked halves H (top) and B (bottom) with the same layout;
 *   their alphas encode a 2D direction d = (H.a·4.08 − 2.08, B.a·4.0645 − 2.0645), k = 1/√(1 + |d|²);
 *   ambient = (B.rgb·k + H.rgb)²
 * - primary (L8) is the sun visibility; the shader adds primary × sat(N·L) × sun color.
 * Output: rgb = (B.rgb·k + H.rgb) / 2 (the viewer squares 2·rgb), a = primary.
 */
export function extractLightmaps(zone: LoadedZone): Lightmap[] {
  const gfx = zone.assets.find(a => a.typeName === 'GfxWorld')?.value
  const out: Lightmap[] = []
  const bytesOf = (img: any): Uint8Array | null => {
    const d = img?.texture?.loadDef?.data
    return d ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength) : null
  }
  for (const lm of gfx?.draw?.lightmaps ?? []) {
    const prim = resolveVal(zone, lm.primary), sec = resolveVal(zone, lm.secondary)
    const pd = bytesOf(prim), sd = bytesOf(sec)
    if (!pd || !sd) { out.push({ width: 1, height: 1, rgba: new Uint8Array([128, 128, 128, 255]) }); continue }
    const w = prim.width, h = prim.height, sw = sec.width, half = sec.height / 2
    const rgba = new Uint8Array(w * h * 4)
    for (let y = 0; y < h; y++) {
      const sy = Math.min(half - 1, (y * half / h) | 0)
      for (let x = 0; x < w; x++) {
        const sx = Math.min(sw - 1, (x * sw / w) | 0)
        const t = (sy * sw + sx) * 4, b = ((sy + half) * sw + sx) * 4 // BGRA
        const dx = sd[t + 3] / 255 * 4.08 - 2.08, dy = sd[b + 3] / 255 * 4.064516 - 2.064516
        const k = Math.min(1, 1 / Math.sqrt(1 + dx * dx + dy * dy))
        const o = (y * w + x) * 4
        rgba[o] = (sd[b + 2] * k + sd[t + 2]) / 2
        rgba[o + 1] = (sd[b + 1] * k + sd[t + 1]) / 2
        rgba[o + 2] = (sd[b] * k + sd[t]) / 2
        rgba[o + 3] = pd[y * w + x]
      }
    }
    out.push({ width: w, height: h, rgba })
  }
  return out
}

/** Name of the sky cube map (GfxWorld.skies[0].skyImage), when the map has one. */
export function extractSkyImage(zone: LoadedZone): string | null {
  const gfx = zone.assets.find(a => a.typeName === 'GfxWorld')?.value
  const img = resolveVal(zone, gfx?.skies?.[0]?.skyImage)
  return typeof img?.name === 'string' ? img.name : null
}

// ---------------------------------------------------------------- game-mode objectives

export type ObjectiveKind = 'domination' | 'bombzone' | 'ctf_flag' | 'headquarters' | 'sabotage'

export interface Objective {
  kind: ObjectiveKind
  /** "A", "B", "allies", ... */
  label: string
  /** game units, Z-up */
  origin: [number, number, number]
  /** trigger radius / height in game units, when known */
  radius?: number
  height?: number
}

/** Objectives of the multiplayer modes (domination flags, bomb sites, CTF flags, HQ), from the entities. */
export function extractObjectives(entities: Entity[]): Objective[] {
  const out: Objective[] = []
  const label = (e: Entity) => (e.script_label ?? '').replace(/^_/, '').toUpperCase()
  const seen = new Set<string>()
  const push = (o: Objective) => {
    const k = `${o.kind}:${o.label}:${o.origin.map(v => Math.round(v / 64)).join(',')}`
    if (!seen.has(k)) { seen.add(k); out.push(o) }
  }
  for (const e of entities) {
    const origin = parseVec3(e.origin)
    if (!origin) continue
    const num = (v?: string) => (v !== undefined && Number.isFinite(Number(v)) ? Number(v) : undefined)
    if (e.targetname === 'flag_primary') push({ kind: 'domination', label: label(e) || '?', origin, radius: num(e.radius), height: num(e.height) })
    else if (e.targetname === 'bombzone' && e.classname === 'trigger_use_touch') push({ kind: 'bombzone', label: label(e) || '?', origin })
    else if (/^ctf_flag_(allies|axis)$/.test(e.targetname ?? '')) push({ kind: 'ctf_flag', label: e.targetname!.slice(9), origin })
    else if (e.targetname === 'hq_hardpoint') push({ kind: 'headquarters', label: 'HQ', origin })
    else if (/^sab_bomb_(allies|axis)$/.test(e.targetname ?? '')) push({ kind: 'sabotage', label: e.targetname!.slice(9), origin })
  }
  return out
}

// ---------------------------------------------------------------- triggers

export interface TriggerVolume {
  classname: string
  targetname?: string
  /** axis-aligned boxes in game units, world space (hull bounds are relative to the entity origin; the slabs that cut them are not applied) */
  boxes: { center: [number, number, number]; half: [number, number, number] }[]
  /** outline of the exact hulls (bounds cut by their slabs): segments x1 y1 z1 x2 y2 z2, game units, world space */
  edges: number[]
}

/** Brush triggers (`model "?N"`): the hulls of trigger model N in MapEnts.trigger. */
export function extractTriggers(zone: LoadedZone, entities: Entity[]): TriggerVolume[] {
  const clip = zone.assets.find(a => a.typeName === 'clipMap_t')?.value
  const me = resolveVal(zone, clip?.mapEnts)
  const trig = me?.trigger
  const models = resolveVal(zone, trig?.models), hulls = resolveVal(zone, trig?.hulls), slabs = resolveVal(zone, trig?.slabs)
  if (!models || !hulls) return []
  const at = (arr: any, i: number) => (arr instanceof PlainArray ? arr.get(i) : arr[i])
  const out: TriggerVolume[] = []
  for (const e of entities) {
    const m = /^\?(\d+)$/.exec(e.model ?? '')
    if (!m) continue
    const idx = Number(m[1])
    if (idx >= (trig.count ?? 0)) continue
    const model = at(models, idx)
    const o = parseVec3(e.origin) ?? [0, 0, 0]
    const boxes: TriggerVolume['boxes'] = []
    const edges: number[] = []
    for (let h = 0; h < model.hullCount; h++) {
      const hull = at(hulls, model.firstHull + h)
      const b = hull.bounds
      boxes.push({ center: [o[0] + b.midPoint.x, o[1] + b.midPoint.y, o[2] + b.midPoint.z], half: [b.halfSize.x, b.halfSize.y, b.halfSize.z] })
      // exact hull: the bounds intersected with each slab |dir·p - midPoint| <= halfSize (local coordinates)
      const m = b.midPoint, hs = b.halfSize
      const planes: Plane[] = [
        [1, 0, 0, m.x + hs.x], [-1, 0, 0, -(m.x - hs.x)], [0, 1, 0, m.y + hs.y],
        [0, -1, 0, -(m.y - hs.y)], [0, 0, 1, m.z + hs.z], [0, 0, -1, -(m.z - hs.z)],
      ]
      for (let s = 0; slabs && s < hull.slabCount; s++) {
        const sl = at(slabs, hull.firstSlab + s)
        const [dx, dy, dz] = [sl.dir[0], sl.dir[1], sl.dir[2]]
        planes.push([dx, dy, dz, sl.midPoint + sl.halfSize], [-dx, -dy, -dz, -(sl.midPoint - sl.halfSize)])
      }
      for (const poly of convexFaces(planes)) {
        for (let k = 0; k < poly.length; k++) {
          const p = poly[k], q = poly[(k + 1) % poly.length]
          edges.push(o[0] + p[0], o[1] + p[1], o[2] + p[2], o[0] + q[0], o[1] + q[1], o[2] + q[2])
        }
      }
    }
    if (boxes.length) out.push({ classname: e.classname ?? '', targetname: e.targetname, boxes, edges })
  }
  return out
}
