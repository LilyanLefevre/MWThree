import { fallbackTexture } from './fallback'
import {
  FastFileLoader, ZoneLoader, ImageLibrary, parseIwi, iwiCompressedMips, extractWorldMesh, extractMapEnts, extractCollisionMesh,
  extractStaticModels, extractEntityModels, extractMaterialImages, extractMaterialNormals, extractMaterialBlends, extractOpaqueMaterials, extractLightmaps, extractSun, extractFog, extractSkyImage, extractObjectives, extractTriggers, computePropLighting, parseVec3,
  parseIwiCube, cubeToEquirect,
} from '@mwthree/iw5-core'
import type { LoadedZone } from '@mwthree/iw5-core'
import { openSource } from './sources'
import { cacheGet, cacheKey, cachePut, transferablesOf } from './cache'
import type { IwdSource, MapRequest, MapResponse, SpawnPoint, TextureData } from './protocol'

type DoneMessage = Extract<MapResponse, { type: 'done' }>
type TexturesMessage = Extract<MapResponse, { type: 'textures' }>

const post = (msg: MapResponse, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer)

/** Post a message, keeping a cached copy first (its buffers are transferred, i.e. detached, by the post). */
async function postAndCache(key: string, msg: DoneMessage) {
  await cachePut(key, msg)
  post(msg, transferablesOf(msg))
}

/** Chrome refuses IndexedDB values over ~127 MB (mp_paris textures: 137 MB): textures are stored in chunks. */
const TEXTURE_CHUNK_BYTES = 64 << 20
const textureBytes = (t: TextureData) => (t.rgba?.byteLength ?? 0) + (t.compressed?.mips.reduce((a, m) => a + m.data.byteLength, 0) ?? 0)

async function postAndCacheTextures(key: string, msg: TexturesMessage) {
  const chunks: TextureData[][] = [[]]
  let size = 0
  for (const t of msg.textures) {
    if (size > TEXTURE_CHUNK_BYTES) { chunks.push([]); size = 0 }
    chunks[chunks.length - 1].push(t); size += textureBytes(t)
  }
  for (let i = 0; i < chunks.length; i++) await cachePut(`${key}:${i}`, chunks[i])
  await cachePut(key, { ...msg, textures: [], chunks: chunks.length })
  post(msg, transferablesOf(msg))
}

async function cachedTextures(key: string): Promise<TexturesMessage | undefined> {
  const head = await cacheGet<TexturesMessage & { chunks: number }>(key)
  if (!head) return undefined
  const parts = await Promise.all(Array.from({ length: head.chunks }, (_, i) => cacheGet<TextureData[]>(`${key}:${i}`)))
  if (parts.some(p => !p)) return undefined
  const { chunks: _, ...msg } = head
  return { ...msg, textures: parts.flat() as TextureData[] }
}

function buildGeometry(zone: LoadedZone, fileName: string, zoneBytes: number, times: { decompress: number; parse: number; start: number }): DoneMessage {
  const mesh = extractWorldMesh(zone)
  if (!mesh) throw new Error('Aucun GfxWorld dans cette zone (pas une map ?)')
  const entities = extractMapEnts(zone)
  const collision = extractCollisionMesh(zone)
  const worldModels = extractStaticModels(zone)
  const { batches: entityModels, missing: missingModels } = extractEntityModels(zone, entities)
  const staticModels = [...worldModels, ...entityModels]
  const sun = extractSun(zone)
  const lightmaps = extractLightmaps(zone)
  const propLight = computePropLighting(zone.assets.find(a => a.typeName === 'GfxWorld')?.value?.lightGrid, staticModels)

  const spawns: SpawnPoint[] = []
  for (const ent of entities) {
    const cn = ent.classname ?? ''
    if (!/spawn/.test(cn)) continue
    const o = parseVec3(ent.origin)
    if (!o) continue
    spawns.push({ classname: cn, origin: o, angles: parseVec3(ent.angles) ?? [0, 0, 0] })
  }
  const counts: Record<string, number> = {}
  for (const a of zone.assets) counts[a.typeName ?? `type${a.type}`] = (counts[a.typeName ?? `type${a.type}`] ?? 0) + 1

  return {
    type: 'done',
    fileName,
    positions: mesh.positions, normals: mesh.normals, uvs: mesh.uvs, lmUvs: mesh.lmUvs, vertexColors: mesh.vertexColors,
    lightmaps, colors: mesh.colors, indices: mesh.indices, groups: mesh.groups,
    collision: collision && { positions: collision.positions, indices: collision.indices, brushes: collision.brushCount },
    staticModels: staticModels.map((m, i) => ({ ...m, instanceLight: propLight[i] })),
    sun,
    fog: extractFog(zone),
    materialBlends: extractMaterialBlends(zone),
    opaqueMaterials: extractOpaqueMaterials(zone),
    spawns,
    objectives: extractObjectives(entities),
    triggers: extractTriggers(zone, entities),
    stats: {
      zoneBytes, assets: zone.assets.length, assetCounts: counts,
      entities: entities.length, surfaces: mesh.surfaces.length,
      staticModels: staticModels.length, staticInstances: staticModels.reduce((a, m) => a + m.matrices.length / 16, 0), textures: 0,
      entityProps: entityModels.reduce((a, m) => a + m.matrices.length / 16, 0), missingEntityModels: missingModels.length,
      msDecompress: Math.round(times.decompress), msParse: Math.round(times.parse), msTotal: Math.round(performance.now() - times.start),
      fromCache: false,
    },
  }
}

async function buildTextures(zone: LoadedZone, propMaterials: Set<string>, iwd: IwdSource[], s3tc: boolean): Promise<TexturesMessage> {
  const start = performance.now()
  const materialImages = extractMaterialImages(zone)
  const allNormals = extractMaterialNormals(zone)
  // normal maps only matter for dynamically lit surfaces (the props); the world is lit by its lightmaps
  const materialNormals: Record<string, string | null> = {}
  for (const n of propMaterials) materialNormals[n] = allNormals[n] ?? null
  const lib = new ImageLibrary()
  await lib.addArchives(await Promise.all(iwd.map(openSource)))
  const wanted = [...new Set(Object.values(materialImages).filter((n): n is string => !!n))]
  const wantedNormals = [...new Set(Object.values(materialNormals).filter((n): n is string => !!n))]
  const textures: TextureData[] = []
  let missing = 0
  let done = 0

  const decode = async (name: string, normal: boolean) => {
    try {
      const data = await lib.readIwi(name)
      if (!data) {
        if (normal) return
        missing++
        const stand = await fallbackTexture(name)
        if (stand) textures.push({ name, width: stand.width, height: stand.height, rgba: stand.rgba, hasAlpha: false })
        return
      }
      const packed = !normal && s3tc ? iwiCompressedMips(data, 512) : null
      if (packed) {
        textures.push({ name, width: packed.width, height: packed.height, hasAlpha: packed.hasAlpha, compressed: { kind: packed.kind, mips: packed.mips } })
        if (++done % 25 === 0) post({ type: 'progress', stage: `Textures ${done}/${wanted.length + wantedNormals.length}` })
        return
      }
      const img = parseIwi(data, normal ? 256 : 512, normal)
      let hasAlpha = false
      if (!normal) for (let k = 3; k < img.rgba.length; k += 4) if (img.rgba[k] < 250) { hasAlpha = true; break }
      textures.push({ name, width: img.width, height: img.height, rgba: img.rgba, hasAlpha, ...(normal ? { normal: true } : {}) })
    } catch {
      if (!normal) missing++ // a broken normal map just keeps the flat normal
    }
    if (++done % 25 === 0) post({ type: 'progress', stage: `Textures ${done}/${wanted.length + wantedNormals.length}` })
  }
  // reads are I/O bound: keep several in flight (decoding stays on this thread)
  const queue = [...wanted.map(n => [n, false] as const), ...wantedNormals.map(n => [n, true] as const)]
  await Promise.all(Array.from({ length: 8 }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) await decode(job[0], job[1])
  }))

  let sky: TexturesMessage['sky'] = null
  const skyName = extractSkyImage(zone)
  if (skyName) {
    try {
      const data = await lib.readIwi(skyName)
      const faces = data && parseIwiCube(data)
      if (faces) sky = { width: 2048, height: 1024, rgba: cubeToEquirect(faces, 2048, 1024) }
    } catch { /* keep the plain background */ }
  }
  return { type: 'textures', textures, materialImages, materialNormals, missing, sky, ms: Math.round(performance.now() - start) }
}

self.onmessage = async (e: MessageEvent<MapRequest>) => {
  const { buffer, fileName, iwd, s3tc } = e.data
  try {
    const start = performance.now()
    // the textures depend on the archives too: a folder with fewer .iwd must not reuse (or poison) a fuller entry
    const archives = iwd.map(s => ('file' in s ? `${s.file.name}:${s.file.size}` : s.url.split('/').pop())).sort().join('|')
    let h = 0
    for (let i = 0; i < archives.length; i++) h = Math.imul(h ^ archives.charCodeAt(i), 16777619)
    const key = `${cacheKey(fileName, buffer)}${s3tc ? ':s3tc' : ''}:${iwd.length}-${(h >>> 0).toString(16)}`

    post({ type: 'progress', stage: 'Recherche dans le cache' })
    const cachedGeo = await cacheGet<DoneMessage>(`${key}:geo`)
    const cachedTex = iwd.length ? await cachedTextures(`${key}:tex`) : undefined
    if (cachedGeo && (cachedTex || !iwd.length)) {
      cachedGeo.stats = { ...cachedGeo.stats, fromCache: true, msTotal: Math.round(performance.now() - start) }
      post(cachedGeo, transferablesOf(cachedGeo))
      if (cachedTex) post(cachedTex, transferablesOf(cachedTex))
      return
    }

    post({ type: 'progress', stage: 'Décompression du FastFile' })
    const zoneBuf = await new FastFileLoader(buffer).loadAsync()
    const t1 = performance.now()
    post({ type: 'progress', stage: 'Lecture de la zone (assets)' })
    const zone = new ZoneLoader(zoneBuf, { zoneNames: [fileName.replace(/\.ff$/i, '')] }).load()
    const t2 = performance.now()

    post({ type: 'progress', stage: 'Construction de la géométrie' })
    const geo = buildGeometry(zone, fileName, zoneBuf.byteLength, { decompress: t1 - start, parse: t2 - t1, start })
    const propMaterials = new Set(geo.staticModels.flatMap(m => [...m.groups, ...(m.far?.groups ?? [])].map(g => g.material)))
    await postAndCache(`${key}:geo`, geo)

    // textures are streamed after the geometry so the map is explorable immediately
    if (iwd.length) await postAndCacheTextures(`${key}:tex`, await buildTextures(zone, propMaterials, iwd, s3tc))
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
