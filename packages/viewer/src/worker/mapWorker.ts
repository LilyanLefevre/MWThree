import {
  FastFileLoader, ZoneLoader, ImageLibrary, parseIwi, extractWorldMesh, extractMapEnts, extractCollisionMesh,
  extractStaticModels, extractEntityModels, extractMaterialImages, extractMaterialNormals, extractLightmaps, extractSun, computePropLighting, parseVec3,
} from '@mwthree/iw5-core'
import { openSource } from './sources'
import type { MapRequest, MapResponse, SpawnPoint, TextureData } from './protocol'

const post = (msg: MapResponse, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer)

self.onmessage = async (e: MessageEvent<MapRequest>) => {
  const { buffer, fileName, iwd } = e.data
  try {
    const t0 = performance.now()
    post({ type: 'progress', stage: 'Décompression du FastFile' })
    const zoneBuf = await new FastFileLoader(buffer).loadAsync()
    const t1 = performance.now()

    post({ type: 'progress', stage: 'Lecture de la zone (assets)' })
    const zone = new ZoneLoader(zoneBuf).load()
    const t2 = performance.now()

    post({ type: 'progress', stage: 'Construction de la géométrie' })
    const mesh = extractWorldMesh(zone)
    if (!mesh) throw new Error('Aucun GfxWorld dans cette zone (pas une map ?)')
    const entities = extractMapEnts(zone)
    const collision = extractCollisionMesh(zone)
    const worldModels = extractStaticModels(zone)
    const { batches: entityModels, missing: missingModels } = extractEntityModels(zone, entities)
    const staticModels = [...worldModels, ...entityModels]
    const sun = extractSun(zone)
    const lightmaps = extractLightmaps(zone, sun)
    const propLight = computePropLighting(mesh, lightmaps, staticModels)
    const staticModelData = staticModels.map((m, i) => ({ ...m, instanceColors: propLight[i] }))

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

    post(
      {
        type: 'done',
        fileName,
        positions: mesh.positions, normals: mesh.normals, uvs: mesh.uvs, lmUvs: mesh.lmUvs, vertexColors: mesh.vertexColors, lightmaps, colors: mesh.colors, indices: mesh.indices, groups: mesh.groups,
        collision: collision && { positions: collision.positions, indices: collision.indices, brushes: collision.brushCount },
        staticModels: staticModelData,
        sun,
        spawns,
        stats: {
          zoneBytes: zoneBuf.byteLength, assets: zone.assets.length, assetCounts: counts,
          entities: entities.length, surfaces: mesh.surfaces.length,
          staticModels: staticModels.length, staticInstances: staticModels.reduce((a, m) => a + m.matrices.length / 16, 0), textures: 0, entityProps: entityModels.reduce((a, m) => a + m.matrices.length / 16, 0), missingEntityModels: missingModels.length,
          msDecompress: Math.round(t1 - t0), msParse: Math.round(t2 - t1), msTotal: Math.round(performance.now() - t0),
        },
      },
      [mesh.positions.buffer, mesh.normals.buffer, mesh.uvs.buffer, mesh.lmUvs.buffer, mesh.vertexColors.buffer, ...lightmaps.map(l => l.rgba.buffer), mesh.colors.buffer, mesh.indices.buffer, ...(collision ? [collision.positions.buffer, collision.indices.buffer] : []),
        ...staticModelData.flatMap(m => [m.positions.buffer, m.normals.buffer, m.uvs.buffer, m.colors.buffer, m.indices.buffer, m.matrices.buffer, m.instanceColors.buffer])],
    )

    // textures are streamed after the geometry so the map is explorable immediately
    if (iwd.length) {
      const materialImages = extractMaterialImages(zone)
      const allNormals = extractMaterialNormals(zone)
      // normal maps only matter for dynamically lit surfaces (the props); the world is lit by its lightmaps
      const propMaterials = new Set(staticModels.flatMap(m => m.groups.map(g => g.material)))
      const materialNormals: Record<string, string | null> = {}
      for (const n of propMaterials) materialNormals[n] = allNormals[n] ?? null
      const lib = new ImageLibrary()
      for (const src of iwd) await lib.addArchive(await openSource(src))
      const wanted = [...new Set(Object.values(materialImages).filter((n): n is string => !!n))]
      const wantedNormals = [...new Set(Object.values(materialNormals).filter((n): n is string => !!n))]
      const textures: TextureData[] = []
      let missing = 0
      for (let i = 0; i < wanted.length; i++) {
        const name = wanted[i]
        if (i % 25 === 0) post({ type: 'progress', stage: `Textures ${i}/${wanted.length}` })
        try {
          const data = await lib.readIwi(name)
          if (!data) { missing++; continue }
          const img = parseIwi(data, 512)
          let hasAlpha = false
          for (let k = 3; k < img.rgba.length; k += 4) if (img.rgba[k] < 250) { hasAlpha = true; break }
          textures.push({ name, width: img.width, height: img.height, rgba: img.rgba, hasAlpha })
        } catch { missing++ }
      }
      for (const name of wantedNormals) {
        try {
          const data = await lib.readIwi(name)
          if (!data) continue
          const img = parseIwi(data, 256, true)
          textures.push({ name, width: img.width, height: img.height, rgba: img.rgba, hasAlpha: false, normal: true })
        } catch { /* keep the flat normal */ }
      }
      post({ type: 'textures', textures, materialImages, materialNormals, missing }, textures.map(t => t.rgba.buffer))
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
