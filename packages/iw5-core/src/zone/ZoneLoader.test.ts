import { beforeAll, describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FastFileLoader } from '../FastFileLoader.js'
import { ZoneLoader, type LoadedZone } from './ZoneLoader.js'
import { extractEntityModels, extractMapEnts, extractStaticModels, extractSun, extractFog, extractMaterialBlends, extractOpaqueMaterials, extractWorldMesh } from './MapExtract.js'
import { sampleLightGrid } from './LightGrid.js'

// Integration test against a real retail zone. Game files are never committed:
// the test is skipped when the local copy is missing.
const DOME = join(__dirname, '../../../../inputs/zone/dome/mp_dome.ff')

describe.skipIf(!existsSync(DOME))('ZoneLoader (mp_dome.ff)', () => {
  // read in beforeAll: a skipped describe still runs its body when tests are collected (CI has no game files)
  let zoneBuf!: ArrayBuffer, zone!: LoadedZone
  beforeAll(() => {
    const raw = readFileSync(DOME)
    zoneBuf = new FastFileLoader(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer).load()
    zone = new ZoneLoader(zoneBuf).load()
  }, 120_000)

  it('consumes the whole zone stream', () => {
    expect(zone.bytesRead).toBe(zoneBuf.byteLength)
    expect(zone.assets).toHaveLength(792)
  })

  it('reproduces the block sizes declared in the XFile header', () => {
    // TEMP is a scratch block: it is not accumulated.
    for (let b = 1; b < 9; b++) expect(zone.blockUsed[b]).toBe(zone.header.blockSizes[b])
  })

  it('extracts a consistent world mesh', () => {
    const mesh = extractWorldMesh(zone)!
    expect(mesh.indices.length % 3).toBe(0)
    let max = 0
    for (const i of mesh.indices) if (i > max) max = i
    expect(max).toBeLessThan(mesh.positions.length / 3)
    expect(mesh.surfaces.length).toBeGreaterThan(5000)
  })

  it('extracts instanced static models', () => {
    const batches = extractStaticModels(zone)
    expect(batches.length).toBeGreaterThan(100)
    for (const b of batches) {
      let max = 0
      for (const i of b.indices) if (i > max) max = i
      expect(max).toBeLessThan(b.positions.length / 3)
      expect(b.matrices.length % 16).toBe(0)
    }
  })

  it('places entity models and finds the sun', () => {
    const { batches, missing } = extractEntityModels(zone, extractMapEnts(zone))
    expect(batches.length).toBeGreaterThan(0)
    expect(Array.isArray(missing)).toBe(true)
    const sun = extractSun(zone)!
    expect(Math.hypot(...sun.direction)).toBeCloseTo(1, 3)
    expect(sun.color[0]).toBeGreaterThan(0)
  })

  it('finds light grid probes for the props, sunlit and shaded', () => {
    const grid = zone.assets.find(a => a.typeName === 'GfxWorld')!.value.lightGrid
    let found = 0, total = 0, sunlit = 0, shaded = 0
    for (const b of extractStaticModels(zone)) for (let i = 0; i < b.matrices.length / 16; i++) {
      const m = b.matrices.subarray(i * 16)
      const s = sampleLightGrid(grid, m[12] / 0.0254, -m[14] / 0.0254, m[13] / 0.0254 + 16)
      total++
      if (!s) continue
      found++
      if (s.sunWeight > 0.99) sunlit++
      if (s.sunWeight < 0.01) shaded++
    }
    expect(found / total).toBeGreaterThan(0.98)
    expect(sunlit / found).toBeGreaterThan(0.4)
    expect(shaded / found).toBeGreaterThan(0.1)
  })

  it('reads the fog of the createart script', () => {
    expect(extractFog(zone)).toEqual({ startDist: 1274, halfwayDist: 3080, color: [0.54, 0.63, 0.68], maxOpacity: 0.51 })
  })

  it('finds the blend mode of god rays, glows and multiply decals', () => {
    const b = extractMaterialBlends(zone)
    expect(b['wc/ch_godray01']).toEqual({ blend: 'screen', falloff: true, linear: true })
    expect(b['mc/gfx_floodlight_beam_godray75']).toEqual({ blend: 'add', falloff: true, linear: true })
    expect(b['wc/com_stain_01']).toEqual({ blend: 'multiply', falloff: false, linear: true })
  })

  it('tells opaque materials (alpha is not an opacity) from alpha-tested and blended ones', () => {
    const opaque = new Set(extractOpaqueMaterials(zone))
    expect(opaque.has('wc/ch_concretewall02')).toBe(true) // wc_l_sm_r0c0n0s0
    expect(opaque.has('wc/me_fence_chainlink')).toBe(false) // wc_l_sm_t0c0n0s0: alpha-tested
    expect(opaque.has('wc/me_ground_drygrass_dec')).toBe(false) // ,wc_l_sm_b0c0n0s0: blended decal
    expect(opaque.has('wc/ch_godray01')).toBe(false) // unlit effect
  })

  it('extracts map entities', () => {
    const ents = extractMapEnts(zone)
    expect(ents[0].classname).toBe('worldspawn')
    expect(ents.some(e => e.classname === 'mp_dm_spawn')).toBe(true)
  })
}, 180_000)
