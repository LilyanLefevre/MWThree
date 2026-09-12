import {
  FastFileLoader, ZoneLoader, ImageLibrary, parseIwi, iwiCompressedMips, extractWorldMesh, extractMapEnts, extractCollisionMesh,
  extractStaticModels, extractEntityModels, extractMaterialImages, extractMaterialNormals, extractMaterialBlends, extractLightmaps, extractSun, extractFog, extractSkyImage, extractObjectives, extractTriggers, computePropLighting, parseVec3,
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
async function postAndCache(key: string, msg: DoneMessage | TexturesMessage) {
  await cachePut(key, msg)
  post(msg, transferablesOf(msg))
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
      if (!data) { if (!normal) missing++; return }
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
    const key = `${cacheKey(fileName, buffer)}${s3tc ? ':s3tc' : ''}`

    post({ type: 'progress', stage: 'Recherche dans le cache' })
    const cachedGeo = await cacheGet<DoneMessage>(`${key}:geo`)
    const cachedTex = iwd.length ? await cacheGet<TexturesMessage>(`${key}:tex`) : undefined
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
    const zone = new ZoneLoader(zoneBuf).load()
    const t2 = performance.now()

    post({ type: 'progress', stage: 'Construction de la géométrie' })
    const geo = buildGeometry(zone, fileName, zoneBuf.byteLength, { decompress: t1 - start, parse: t2 - t1, start })
    const propMaterials = new Set(geo.staticModels.flatMap(m => [...m.groups, ...(m.far?.groups ?? [])].map(g => g.material)))
    await postAndCache(`${key}:geo`, geo)

    // textures are streamed after the geometry so the map is explorable immediately
    if (iwd.length) await postAndCache(`${key}:tex`, await buildTextures(zone, propMaterials, iwd, s3tc))
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
