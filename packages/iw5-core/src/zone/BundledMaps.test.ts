import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FastFileLoader } from '../FastFileLoader.js'
import { ZoneLoader } from './ZoneLoader.js'
import { extractCollisionMesh } from './Collision.js'
import { extractFog, extractMapEnts, extractStaticModels, extractSun, extractWorldMesh } from './MapExtract.js'

// The community maps shipped with the project (maps/): the reference for the ZoneTool format, tested in CI.
const MAPS = join(__dirname, '../../../../maps')

const EXPECTED = [
  // name, assets, min world triangles, min spawns
  { name: 'mp_shipment', assets: 1966, tris: 50_000, spawns: 100 },
  { name: 'mp_rust_long', assets: 2325, tris: 250_000, spawns: 200 },
]

describe.each(EXPECTED)('bundled map $name', ({ name, assets, tris, spawns }) => {
  const file = join(MAPS, name, `${name}.ff`)

  it.skipIf(!existsSync(file))('reads to the last byte and extracts', () => {
    const raw = readFileSync(file)
    const zoneBuf = new FastFileLoader(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer).load()
    const zone = new ZoneLoader(zoneBuf, { zoneNames: [name] }).load()
    expect(zone.assets).toHaveLength(assets)
    // a few bytes of accounting differ in ZoneTool zones (hooks of the modified engine), nothing the reader depends on
    expect(zoneBuf.byteLength - zone.bytesRead).toBeLessThan(64)
    for (const i of [3, 6, 7]) expect(zone.blockUsed[i]).toBeGreaterThan(0)

    const mesh = extractWorldMesh(zone)!
    expect(mesh.indices.length / 3).toBeGreaterThan(tris)
    let maxIndex = 0
    for (const i of mesh.indices) if (i > maxIndex) maxIndex = i
    expect(maxIndex).toBeLessThan(mesh.positions.length / 3)
    const ents = extractMapEnts(zone)
    expect(ents.filter(e => /spawn/.test(e.classname ?? '')).length).toBeGreaterThan(spawns)
    expect(extractStaticModels(zone).length).toBeGreaterThan(30)
    expect(extractSun(zone)).not.toBeNull()
    expect(extractFog(zone)).not.toBeNull()
    const col = extractCollisionMesh(zone)!
    expect(col.brushCount).toBeGreaterThan(1000)
    // submodel brushes (triggers) are local to their entity and must not pile up at the origin
    let atOrigin = 0
    for (let i = 0; i < col.positions.length; i += 3) if (Math.hypot(col.positions[i], col.positions[i + 2]) < 0.05) atOrigin++
    expect(atOrigin).toBeLessThan(8)
  }, 120_000)
})
