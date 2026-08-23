// Smoke test: load every mp_* zone and run all extractors. Usage: npx tsx scripts/checkMaps.mts [inputs/zone]
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { FastFileLoader } from '../packages/iw5-core/src/FastFileLoader.ts'
import { ZoneLoader } from '../packages/iw5-core/src/zone/ZoneLoader.ts'
import {
  extractWorldMesh, extractMapEnts, extractStaticModels, extractEntityModels, extractMaterialImages, extractMaterialNormals,
  extractLightmaps, extractSun, extractSkyImage, extractObjectives,
} from '../packages/iw5-core/src/zone/MapExtract.ts'
import { computePropLighting } from '../packages/iw5-core/src/zone/PropLighting.ts'
import { extractCollisionMesh } from '../packages/iw5-core/src/zone/Collision.ts'

const root = process.argv[2] ?? 'inputs/zone'
for (const dir of readdirSync(root).sort()) {
  const f = join(root, dir, `mp_${dir}.ff`)
  if (!existsSync(f)) continue
  try {
    const raw = readFileSync(f)
    const z = new ZoneLoader(new FastFileLoader(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer).load()).load()
    const mesh = extractWorldMesh(z)!, ents = extractMapEnts(z), props = extractStaticModels(z), col = extractCollisionMesh(z)!, mats = extractMaterialImages(z)
    const spawns = ents.filter(e => /spawn/.test(e.classname ?? '')).length
    const entityModels = extractEntityModels(z, ents)
    const sun = extractSun(z), lightmaps = extractLightmaps(z, sun)
    computePropLighting(mesh, lightmaps, [...props, ...entityModels.batches])
    extractMaterialNormals(z)
    const extra = `entityProps ${entityModels.batches.reduce((a, p) => a + p.matrices.length / 16, 0)} (missing ${entityModels.missing.length}) lightmaps ${lightmaps.length} sun ${sun ? 'yes' : 'no'} sky ${extractSkyImage(z) ?? '-'} objectives ${extractObjectives(ents).length}`
    let bad = 0; for (const i of mesh.indices) if (i >= mesh.positions.length / 3) bad++
    console.log(`${dir.padEnd(12)} tris ${mesh.indices.length / 3 | 0} props ${props.reduce((a, p) => a + p.matrices.length / 16, 0)} brushes ${col.brushCount} ents ${ents.length} spawns ${spawns} materials ${Object.keys(mats).length} ${extra}${bad ? ' BAD INDICES ' + bad : ''}`)
  } catch (e: any) { console.log(`${dir.padEnd(12)} FAIL ${e.message.split('\n')[0]}`) }
}
