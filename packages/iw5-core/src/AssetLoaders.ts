import { ZoneStream, POINTER_FOLLOWING } from './ZoneStream.js'

export interface StringTable {
  name: string
  columnCount: number
  rowCount: number
  values: { string: string | null; hash: number }[]
}

export interface RawFile {
  name: string
  len: number
  data: Uint8Array
}

export interface ScriptFile {
  name: string
  compressedLen: number
  len: number
  bytecode: Uint8Array
}

export interface LoadedAsset {
  rawType: number
  typeName: string
  name: string
  data: unknown
  offset: number
  size: number
}

function readFollowString(stream: ZoneStream): string {
  const ptr = stream.u32()
  if (ptr === POINTER_FOLLOWING) return stream.cstring()
  if (ptr === 0) return ''
  return `<ref:0x${ptr.toString(16)}>`
}

function readNameFollow(stream: ZoneStream): string {
  return readFollowString(stream)
}

const LOADERS: Record<number, (stream: ZoneStream) => LoadedAsset> = {}

LOADERS[40] = (stream): LoadedAsset => {
  const start = stream.tell()
  const namePtr = stream.u32()
  const columnCount = stream.u32()
  const rowCount = stream.u32()
  stream.u32() // values pointer
  let name = ''
  if (namePtr === POINTER_FOLLOWING) name = stream.cstring()

  const cellCount = columnCount * rowCount
  const cellPtrs: number[] = []
  const cellHashes: number[] = []
  for (let i = 0; i < cellCount; i++) {
    cellPtrs.push(stream.u32())
    cellHashes.push(stream.u32())
  }

  const stringDataStart = stream.tell()
  let followingOffset = stringDataStart

  const values: { string: string | null; hash: number }[] = []
  for (let i = 0; i < cellCount; i++) {
    const ptr = cellPtrs[i]
    let str: string | null = null

    if (ptr === POINTER_FOLLOWING) {
      stream.seek(followingOffset)
      str = stream.cstring()
      followingOffset = stream.tell()
    } else if (ptr === 0) {
      str = null
    } else if ((ptr & 0xFFFF0000) === 0xFFFF0000) {
      const strOff = stringDataStart + (ptr & 0xFFFF)
      stream.seek(strOff)
      str = stream.cstring()
    }

    values.push({ string: str, hash: cellHashes[i] })
  }

  stream.seek(followingOffset)

  return {
    rawType: 40,
    typeName: 'STRINGTABLE',
    name,
    data: { name, columnCount, rowCount, values } satisfies StringTable,
    offset: start,
    size: stream.tell() - start,
  }
}

LOADERS[38] = (stream): LoadedAsset => {
  const start = stream.tell()
  const name = readNameFollow(stream)
  const compressedLen = stream.u32()
  const len = stream.u32()
  const bufferPtr = stream.u32()
  let data: Uint8Array = new Uint8Array(0)
  if (bufferPtr === POINTER_FOLLOWING) {
    data = new Uint8Array(stream.bytes(compressedLen))
  }
  return {
    rawType: 38,
    typeName: 'RAWFILE',
    name,
    data: { name, len, data } as RawFile,
    offset: start,
    size: stream.tell() - start,
  }
}

LOADERS[39] = (stream): LoadedAsset => {
  const start = stream.tell()
  const name = readNameFollow(stream)
  const compressedLen = stream.u32()
  const len = stream.u32()
  const bytecodeLen = stream.u32()
  stream.u32() // bufferPtr
  const bytecodePtr = stream.u32()
  let bytecode: Uint8Array = new Uint8Array(0)
  if (bytecodePtr === POINTER_FOLLOWING) bytecode = new Uint8Array(stream.bytes(bytecodeLen))
  return {
    rawType: 39,
    typeName: 'SCRIPTFILE',
    name,
    data: { name, compressedLen, len, bytecode } as ScriptFile,
    offset: start,
    size: stream.tell() - start,
  }
}

// Zone-format header sizes from OAT IW5_Assets.h definitions
// These are the number of fixed bytes read from the stream BEFORE any following data
export const ZONE_HEADER_SIZES: Record<number, number> = {
  0: 68, 1: 72, 2: 88, 3: 36, 4: 308, 5: 100,
  6: 16, 7: 16, 8: 100, 9: 228, 10: 32, 11: 12,
  12: 136, 13: 44, 14: 264, 15: 16, 16: 8, 17: 44,
  18: 12, 19: 112, 20: 124, 21: 636, 22: 24,
  23: 24, 24: 24, 25: 12, 26: 176, 27: 8, 28: 164,
  29: 200, 30: 0, 31: 52, 32: 8, 33: 8,
  34: 8, 35: 8, 36: 8, 37: 8,
  38: 12, 39: 24, 40: 16,
  41: 28, 42: 12, 43: 120, 44: 700, 45: 60,
}


// Measured total consumption for complex types (header + following data)
// Verified experimentally against mp_dome.ff
const FOLLOWING_DATA_SIZES: Record<number, number> = {
  // GFXWORLD: header=636, following=315,356 → total=315,992
  // Verified: GFXWORLD(entry 299) at 0x9C29E → entry 300 at 0xE94F6
  21: 315992,
}

export function skipEntry(stream: ZoneStream, rawType: number): number {
  const start = stream.tell()
  const hdr = ZONE_HEADER_SIZES[rawType] ?? 8

  // Read name (always first field: XString pointer)
  const namePtr = stream.u32()
  if (namePtr === POINTER_FOLLOWING) stream.cstring()
  // Skip remaining header fields
  if (hdr > 4) stream.skip(hdr - 4)

  // Check if there's known following data
  const totalSize = FOLLOWING_DATA_SIZES[rawType]
  if (totalSize) {
    const consumed = stream.tell() - start
    const remaining = totalSize - consumed
    if (remaining > 0) stream.skip(remaining)
    return totalSize
  }

  return stream.tell() - start
}

function skipAsset(stream: ZoneStream, rawType: number): void {
  skipEntry(stream, rawType)
}

export function loadAllAssets(
  stream: ZoneStream,
  entries: { rawType: number; pointer: number }[],
): LoadedAsset[] {
  const result: LoadedAsset[] = []
  for (const entry of entries) {
    if (entry.pointer !== POINTER_FOLLOWING) continue
    const loader = LOADERS[entry.rawType]
    if (loader) {
      result.push(loader(stream))
    } else {
      skipAsset(stream, entry.rawType)
    }
  }
  return result
}

export function loadAssetAt(
  stream: ZoneStream,
  entry: { rawType: number; pointer: number },
  offset: number,
): LoadedAsset | null {
  stream.seek(offset)
  return LOADERS[entry.rawType]?.(stream) ?? null
}

export function* iterateAllAssets(
  stream: ZoneStream,
  entries: { rawType: number; pointer: number }[],
): Generator<LoadedAsset> {
  for (const entry of entries) {
    if (entry.pointer !== POINTER_FOLLOWING) continue
    const loader = LOADERS[entry.rawType]
    if (loader) {
      yield loader(stream)
    } else {
      skipAsset(stream, entry.rawType)
    }
  }
}

// Track position through ALL entries, returning each entry's absolute offset
export function trackPositions(
  stream: ZoneStream,
  entries: { rawType: number; pointer: number }[],
): { index: number; rawType: number; offset: number; size: number }[] {
  const positions: { index: number; rawType: number; offset: number; size: number }[] = []
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    if (e.pointer !== POINTER_FOLLOWING) continue
    const offset = stream.tell()
    const size = skipEntry(stream, e.rawType)
    positions.push({ index: i, rawType: e.rawType, offset, size })
  }
  return positions
}
