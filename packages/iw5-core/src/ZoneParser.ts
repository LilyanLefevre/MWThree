import { ZoneStream, POINTER_FOLLOWING } from './ZoneStream.js'

export const SUPPORTED_ASSET_TYPES: Record<number, string> = {
  0: 'PHYSPRESET',
  1: 'PHYSCOLLMAP',
  2: 'XANIMPARTS',
  3: 'XMODEL_SURFS',
  4: 'XMODEL',
  5: 'MATERIAL',
  6: 'PIXELSHADER',
  7: 'VERTEXSHADER',
  8: 'VERTEXDECL',
  9: 'TECHNIQUE_SET',
  10: 'IMAGE',
  11: 'SOUND',
  12: 'SOUND_CURVE',
  13: 'LOADED_SOUND',
  14: 'CLIPMAP',
  15: 'COMWORLD',
  16: 'GLASSWORLD',
  17: 'PATHDATA',
  18: 'VEHICLE_TRACK',
  19: 'MAP_ENTS',
  20: 'FXWORLD',
  21: 'GFXWORLD',
  22: 'LIGHT_DEF',
  23: 'UI_MAP',
  24: 'FONT',
  25: 'MENULIST',
  26: 'MENU',
  27: 'LOCALIZE_ENTRY',
  28: 'ATTACHMENT',
  29: 'WEAPON',
  30: 'SNDDRIVER_GLOBALS',
  31: 'FX',
  32: 'IMPACT_FX',
  33: 'SURFACE_FX',
  34: 'AITYPE',
  35: 'MPTYPE',
  36: 'CHARACTER',
  37: 'XMODELALIAS',
  38: 'RAWFILE',
  39: 'SCRIPTFILE',
  40: 'STRINGTABLE',
  41: 'LEADERBOARD',
  42: 'STRUCTURED_DATA_DEF',
  43: 'TRACER',
  44: 'VEHICLE',
  45: 'ADDON_MAP_ENTS',
}

export const BLOCK_NAMES = ['TEMP', 'PHYSICAL', 'RUNTIME', 'VIRTUAL', 'LARGE', 'CALLBACK', 'VERTEX', 'INDEX', 'SCRIPT'] as const

export const POINTER_BIT_COUNT = 32
export const OFFSET_BLOCK_BIT_COUNT = 4

export interface XFileHeader {
  size: number
  externalSize: number
  blocks: Record<string, number>
}

export interface XAssetEntry {
  rawType: number
  typeName: string
  pointer: number
  isFollowing: boolean
  offset: number
}

export interface ZoneInfo {
  header: XFileHeader
  stringCount: number
  strings: string[]
  assetCount: number
  assets: XAssetEntry[]
  assetDataStart: number
}

export class ZoneParser {
  private stream: ZoneStream

  constructor(private buffer: ArrayBuffer) {
    this.stream = new ZoneStream(buffer)
  }

  parse(): ZoneInfo {
    const header = this.parseHeader()

    const stringCount = this.stream.u32()
    const stringsPtr = this.stream.u32()
    const assetCount = this.stream.u32()
    const assetsPtr = this.stream.u32()

    let strings: string[] = []
    if (stringsPtr === POINTER_FOLLOWING) {
      strings = this.readScriptStrings(stringCount)
    }

    let assets: XAssetEntry[] = []
    if (assetsPtr === POINTER_FOLLOWING) {
      assets = this.readAssetArray(assetCount)
    }
    const assetDataStart = this.stream.tell()

    return { header, stringCount, strings, assetCount, assets, assetDataStart }
  }

  private parseHeader(): XFileHeader {
    const size = this.stream.u32()
    const externalSize = this.stream.u32()
    const blocks: Record<string, number> = {}

    for (let i = 0; i < 9; i++) {
      const blockSize = this.stream.u32()
      if (blockSize > 0) {
        blocks[BLOCK_NAMES[i]] = blockSize
      }
    }

    return { size, externalSize, blocks }
  }

  private readScriptStrings(count: number): string[] {
    const ptrs: number[] = []
    for (let i = 0; i < count; i++) {
      ptrs.push(this.stream.u32())
    }
    const results: string[] = []
    for (let i = 0; i < count; i++) {
      if (ptrs[i] === POINTER_FOLLOWING) {
        results.push(this.stream.cstring())
      } else if (ptrs[i] === 0) {
        results.push('')
      } else {
        results.push(`<ref:0x${ptrs[i].toString(16)}>`)
      }
    }
    return results
  }

  private readAssetArray(count: number): XAssetEntry[] {
    const assets: XAssetEntry[] = []
    for (let i = 0; i < count; i++) {
      const rawType = this.stream.u32()
      const pointer = this.stream.u32()
      const typeName = SUPPORTED_ASSET_TYPES[rawType] ?? `UNKNOWN_${rawType}`
      assets.push({
        rawType,
        typeName,
        pointer,
        isFollowing: pointer === POINTER_FOLLOWING,
        offset: this.stream.tell(),
      })
    }
    return assets
  }

  findZoneName(): string {
    const bytes = new Uint8Array(this.buffer)
    const len = bytes.length
    const searchStart = Math.max(0, len - 256)
    const decoder = new TextDecoder('ascii')
    let best = 'unknown'
    let i = len - 1
    while (i >= searchStart) {
      if (bytes[i] === 0) { i--; continue }
      let end = i + 1
      while (i > searchStart && bytes[i - 1] !== 0) i--
      const s = decoder.decode(bytes.slice(i, end))
      if (s.length > 2 && s.length <= 64 && /^[\w\-\/.]+$/.test(s)) {
        best = s
        break
      }
      i--
    }
    return best
  }
}
