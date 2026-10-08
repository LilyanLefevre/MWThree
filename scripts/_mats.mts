import { readFileSync } from 'node:fs'
import { FastFileLoader } from '../packages/iw5-core/src/FastFileLoader.ts'
import { ZoneLoader } from '../packages/iw5-core/src/zone/ZoneLoader.ts'
const raw = readFileSync('inputs/zone/dome/mp_dome.ff')
const z = new ZoneLoader(new FastFileLoader(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer).load()).load()
const R = (v: any) => (v && v.$ref !== undefined ? z.resolveRef(v.$ref)?.value : v)
const gfx = z.assets.find(a => a.typeName === 'GfxWorld')!.value
const seen = new Map<string, any>()
for (const s of gfx.dpvs.surfaces) { const m = R(s.material); if (m?.info?.name && !seen.has(m.info.name)) seen.set(m.info.name, m) }
for (const [n, m] of seen) {
  const ts = R(m.techniqueSet)
  const sb = R(m.stateBitsTable)
  const bits = sb ? Array.from({ length: m.stateBitsCount }, (_, i) => { const e = sb[i] ?? sb; return (e.loadBits?.[0] ?? 0) >>> 0 }) : []
  console.log(String(m.info.sortKey).padStart(2), 'cam' + m.cameraRegion, (ts?.name ?? '?').padEnd(40), n, bits.map(b => b.toString(16)).join(','))
}
