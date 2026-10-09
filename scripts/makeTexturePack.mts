// Texture pack for a private instance: pulls from the game's archives only the images the chosen maps use, and writes a small
// folder to share with `scripts/deploy.sh --folder <out>`. Nothing here is meant for git (the default output is git-ignored).
//
//   npx tsx scripts/makeTexturePack.mts dome hardhat shipment rust_long
//   npx tsx scripts/makeTexturePack.mts --game "/path/to/MW3" --out private-pack dome shipment
//
// Output: <out>/main/pack.iwd (the images, an ordinary .iwd), and for the official maps <out>/zone/<map>/mp_<map>.ff.
// Community maps shipped in maps/ are served by the app already: only their base-game textures are added to the pack.
import { copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, fstatSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { FastFileLoader } from '../packages/iw5-core/src/FastFileLoader.ts'
import { ZoneLoader } from '../packages/iw5-core/src/zone/ZoneLoader.ts'
import { extractMaterialImages, extractMaterialNormals, extractSkyImage } from '../packages/iw5-core/src/zone/MapExtract.ts'
import { ImageLibrary } from '../packages/iw5-core/src/textures/Iwd.ts'

const argv = process.argv.slice(2)
const opt = (name: string, fallback: string) => { const i = argv.indexOf(name); if (i < 0) return fallback; const v = argv[i + 1]; argv.splice(i, 2); return v }
const out = opt('--out', 'private-pack')
const game = opt('--game', 'inputs')
const codes = argv.map(c => c.replace(/^mp_/, '').replace(/\.ff$/, ''))
if (!codes.length) { console.error('usage: makeTexturePack.mts [--game DIR] [--out DIR] <map> [<map>…]   (e.g. dome shipment)'); process.exit(1) }

/** Where a map's FastFile can be: the shipped maps, a usermaps folder, or the game's zone folders. */
function findMap(code: string): { file: string; official: boolean } | null {
  const name = `mp_${code}.ff`
  for (const p of [join('maps', `mp_${code}`, name), join(game, 'usermaps', `mp_${code}`, name), join(game, 'zone', code, name)]) {
    if (existsSync(p)) return { file: p, official: p.startsWith(join(game, 'zone')) }
  }
  const zone = join(game, 'zone')
  for (const dir of existsSync(zone) ? readdirSync(zone) : []) if (existsSync(join(zone, dir, name))) return { file: join(zone, dir, name), official: true }
  return null
}

const source = (path: string) => {
  const fd = openSync(path, 'r')
  return { size: fstatSync(fd).size, read: async (offset: number, length: number) => { const b = new Uint8Array(length); readSync(fd, b, 0, length, offset); return b } }
}

// the base game's archives, later ones overriding earlier ones (like the viewer does)
const archives = existsSync(join(game, 'main')) ? readdirSync(join(game, 'main')).filter(n => n.endsWith('.iwd') && !n.startsWith('.')).sort() : []
if (!archives.length) { console.error(`no main/*.iwd in ${game}: pass --game <MW3 folder>`); process.exit(1) }
const lib = new ImageLibrary()
await lib.addArchives(archives.map(n => source(join(game, 'main', n))))

const wanted = new Set<string>()
const maps: { code: string; file: string; official: boolean }[] = []
for (const code of codes) {
  const found = findMap(code)
  if (!found) { console.error(`map not found: ${code}`); process.exit(1) }
  maps.push({ code, ...found })
  const raw = readFileSync(found.file)
  const zone = new ZoneLoader(new FastFileLoader(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer).load(), { zoneNames: [`mp_${code}`] }).load()
  const before = wanted.size
  for (const n of [...Object.values(extractMaterialImages(zone)), ...Object.values(extractMaterialNormals(zone)), extractSkyImage(zone)]) if (n) wanted.add(n)
  // menu images: lobby preview and loading screen (community maps often use a shorter code: mp_rust_long -> mp_rust)
  const parts = code.split('_')
  for (let i = parts.length; i > 0; i--) {
    const c = parts.slice(0, i).join('_')
    for (const n of [`loadscreen_mp_${c}`, `preview_mp_${c}`, `preview_mp_${c}_lobby`]) wanted.add(n)
  }
  console.log(`${code.padEnd(10)} ${wanted.size - before} new images (${wanted.size} in total)`)
}

// --- a minimal zip (deflate), the format of an .iwd
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
const crc32 = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }

const parts: Buffer[] = [], central: Buffer[] = []
let offset = 0, count = 0, bytesIn = 0
const missing: string[] = []
for (const name of [...wanted].sort()) {
  const data = lib.has(name) ? await lib.readIwi(name) : null
  if (!data) { missing.push(name); continue }
  const entryName = Buffer.from(`images/${name}.iwi`, 'utf8')
  const packed = deflateRawSync(data)
  const crc = crc32(data)
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(8, 8)
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(entryName.length, 26)
  const dir = Buffer.alloc(46)
  dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(0x800, 8); dir.writeUInt16LE(8, 10)
  dir.writeUInt32LE(crc, 16); dir.writeUInt32LE(packed.length, 20); dir.writeUInt32LE(data.length, 24); dir.writeUInt16LE(entryName.length, 28); dir.writeUInt32LE(offset, 42)
  parts.push(local, entryName, packed); central.push(dir, entryName)
  offset += local.length + entryName.length + packed.length
  count++; bytesIn += data.length
}
const centralBuf = Buffer.concat(central)
const end = Buffer.alloc(22)
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10); end.writeUInt32LE(centralBuf.length, 12); end.writeUInt32LE(offset, 16)

mkdirSync(join(out, 'main'), { recursive: true })
const packPath = join(out, 'main', 'pack.iwd')
writeFileSync(packPath, Buffer.concat([...parts, centralBuf, end]))
for (const m of maps.filter(m => m.official)) {
  mkdirSync(join(out, 'zone', m.code), { recursive: true })
  copyFileSync(m.file, join(out, 'zone', m.code, basename(m.file)))
}
console.log(`\n${count} images (${(bytesIn / 1e6).toFixed(1)} MB raw) -> ${packPath} (${(statSync(packPath).size / 1e6).toFixed(1)} MB)`)
if (missing.length) console.log(`${missing.length} not found in the game's archives (loading screens of other maps, custom images): ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? '…' : ''}`)
console.log(`maps copied: ${maps.filter(m => m.official).map(m => m.code).join(', ') || 'none'}\nShare it: scripts/deploy.sh --folder ${out} [--password …]`)
