import { FastFileLoader, ZoneLoader, extractWorldMesh, extractMapEnts, extractCollisionMesh, extractStaticModels, parseVec3 } from '@mwthree/iw5-core'
import type { MapRequest, MapResponse, SpawnPoint } from './protocol'

const post = (msg: MapResponse, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer)

self.onmessage = async (e: MessageEvent<MapRequest>) => {
  const { buffer, fileName } = e.data
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
    const staticModels = extractStaticModels(zone)

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
        positions: mesh.positions, normals: mesh.normals, colors: mesh.colors, indices: mesh.indices,
        collision: collision && { positions: collision.positions, indices: collision.indices, brushes: collision.brushCount },
        staticModels,
        spawns,
        stats: {
          zoneBytes: zoneBuf.byteLength, assets: zone.assets.length, assetCounts: counts,
          entities: entities.length, surfaces: mesh.surfaces.length,
          staticModels: staticModels.length, staticInstances: staticModels.reduce((a, m) => a + m.matrices.length / 16, 0),
          msDecompress: Math.round(t1 - t0), msParse: Math.round(t2 - t1), msTotal: Math.round(performance.now() - t0),
        },
      },
      [mesh.positions.buffer, mesh.normals.buffer, mesh.colors.buffer, mesh.indices.buffer, ...(collision ? [collision.positions.buffer, collision.indices.buffer] : []),
        ...staticModels.flatMap(m => [m.positions.buffer, m.normals.buffer, m.colors.buffer, m.indices.buffer, m.matrices.buffer])],
    )
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
