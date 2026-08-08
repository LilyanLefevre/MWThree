import { readFileSync } from 'node:fs'
import { FastFileLoader } from '../packages/iw5-core/src/FastFileLoader.ts'
import { ZoneLoader, schema } from '../packages/iw5-core/src/zone/ZoneLoader.ts'

const file = process.argv[2] ?? 'inputs/zone/dome/mp_dome.ff'
const raw = readFileSync(file)
const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)
const zone = new FastFileLoader(ab as ArrayBuffer).load()
console.log('zone bytes', zone.byteLength)
const loader = new ZoneLoader(zone)
let last = ''
loader.onAsset = (i, a, pos) => {
  last = `#${i} type=${a.type}(${a.typeName}) name=${a.name} pos=${pos}`
  if (process.env.TRACE) console.log(last)
}
try {
  const z = loader.load()
  console.log('OK assets', z.assets.length, 'bytesRead', z.bytesRead, '/', zone.byteLength)
  console.log('header blocks', z.header.blockSizes.join(','))
  console.log('sim blocks   ', z.blockUsed.join(','))
  console.log(loader.stats, loader.diagnostics.slice(0, 5))
} catch (e) {
  console.log('FAIL after', last)
  console.log(e)
}
void schema
