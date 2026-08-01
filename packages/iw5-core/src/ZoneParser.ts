export const SUPPORTED_ASSET_TYPES: Record<number, string> = {
  0: 'PHYSICS_LIBRARY',
  1: 'PHYSICS_PRESET',
  2: 'XMODEL_SURFS',
  3: 'XANIM_PARTS',
  4: 'XMODEL',
  5: 'MATERIAL',
  6: 'PIXEL_SHADER',
  7: 'VERTEX_SHADER',
  8: 'VERTEX_DECL',
  9: 'TECHNIQUE_SET',
  10: 'IMAGE',
  11: 'SOUND',
  12: 'SOUND_CURVE',
  13: 'LOADED_SOUND',
  14: 'CLIP_MAP',
  15: 'CLIP_MAP_PVS',
  16: 'COM_WORLD',
  17: 'GLASS_WORLD',
  18: 'PATH_DATA',
  19: 'MAP_ENTS',
  20: 'GFX_WORLD',
  21: 'FX_WORLD',
  22: 'LIGHT_DEF',
  23: 'UI_MAP',
  24: 'FONT',
  25: 'MENU_LIST',
  26: 'MENU',
  27: 'RAW_FILE',
  28: 'STRING_TABLE',
  29: 'LEADERBOARD',
  30: 'STRUCTURED_DATA_DEF',
  31: 'FX',
  32: 'IMPACT_FX',
  33: 'SURFACE_FX',
  34: 'AI_TYPE',
  35: 'MP_TYPE',
  36: 'CHARACTER',
  37: 'XMODEL_ALIAS',
  38: 'LOCALIZE_ENTRY',
  39: 'RAW_FILE',
  40: 'SCRIPT_FILE',
  41: 'STRING_TABLE',
  42: 'LEADERBOARD',
  43: 'STRUCTURED_DATA_DEF',
  44: 'TRACER',
  45: 'VEHICLE',
  46: 'ADDON_MAP_ENTS',
}

export const BLOCK_NAMES = ['TEMP', 'PHYSICAL', 'RUNTIME', 'VIRTUAL', 'LARGE', 'CALLBACK', 'VERTEX', 'INDEX', 'SCRIPT'] as const

export interface XFileHeader {
  size: number
  externalSize: number
  blocks: Record<string, number>
}

export interface XAssetEntry {
  type: number
  typeName: string
  pointer: number
  isNull: boolean
}

export interface ZoneInfo {
  header: XFileHeader
  stringCount: number
  assetCount: number
  assets: XAssetEntry[]
}

const XFILE_HEADER_BYTE_SIZE = 44

export class ZoneParser {
  private view: DataView
  private decoder: TextDecoder

  constructor(private buffer: ArrayBuffer) {
    this.view = new DataView(buffer)
    this.decoder = new TextDecoder('ascii')
  }

  private u32(offset: number): number {
    return this.view.getUint32(offset, true)
  }

  private readString(offset: number, max: number): string {
    const end = Math.min(offset + max, this.buffer.byteLength)
    let len = 0
    while (offset + len < end && this.view.getUint8(offset + len) !== 0) len++
    return this.decoder.decode(new Uint8Array(this.buffer, offset, len))
  }

  parseHeader(): XFileHeader {
    if (this.buffer.byteLength < XFILE_HEADER_BYTE_SIZE) {
      throw new Error(`Zone trop petite: ${this.buffer.byteLength} bytes`)
    }
    const size = this.u32(0)
    const externalSize = this.u32(4)
    const blocks: Record<string, number> = {}
    for (let i = 0; i < 9; i++) {
      const v = this.u32(8 + i * 4)
      if (v > 0) blocks[BLOCK_NAMES[i]] = v
    }
    return { size, externalSize, blocks }
  }

  parseAssets(): { stringCount: number; assetCount: number; assets: XAssetEntry[] } {
    const pos = XFILE_HEADER_BYTE_SIZE
    const stringCount = this.u32(pos)
    const stringPtr = this.u32(pos + 4)
    const assetCount = this.u32(pos + 8)
    const assetsPtr = this.u32(pos + 12)

    const assets: XAssetEntry[] = []

    if (assetsPtr === 0xFFFFFFFF) {
      const stringPtrSize = stringPtr === 0xFFFFFFFF ? stringCount * 4 : 0
      const stringsStart = pos + 16 + stringPtrSize
      let stringsEnd = stringsStart
      if (stringPtr === 0xFFFFFFFF) {
        for (let i = 0; i < stringCount; i++) {
          if (stringsEnd >= this.buffer.byteLength) break
          while (stringsEnd < this.buffer.byteLength && this.view.getUint8(stringsEnd) !== 0) stringsEnd++
          stringsEnd++
        }
      }
      const entriesStart = stringsEnd
      for (let i = 0; i < assetCount; i++) {
        const off = entriesStart + i * 8
        if (off + 8 > this.buffer.byteLength) break
        const type = this.u32(off)
        const ptr = this.u32(off + 4)
        if (type >= Object.keys(SUPPORTED_ASSET_TYPES).length && type !== 0xFFFFFFFF) continue
        assets.push({
          type,
          typeName: type === 0xFFFFFFFF ? 'TERMINATOR' : (SUPPORTED_ASSET_TYPES[type] ?? `UNKNOWN_${type}`),
          pointer: ptr,
          isNull: ptr === 0 || ptr === 0xFFFFFFFF,
        })
      }
    }

    return { stringCount, assetCount, assets }
  }

  findZoneName(): string {
    const len = this.buffer.byteLength
    const searchStart = Math.max(0, len - 256)
    const bytes = new Uint8Array(this.buffer, searchStart, len - searchStart)
    let best = 'unknown'
    let i = bytes.length - 1
    while (i >= 0) {
      if (bytes[i] === 0) { i--; continue }
      let end = i + 1
      while (i > 0 && bytes[i - 1] !== 0) i--
      const s = this.decoder.decode(bytes.slice(i, end))
      if (s.length > 2 && s.length <= 64 && /^[\w\-\/.]+$/.test(s)) {
        best = s
        break
      }
      i--
    }
    return best
  }

  parse(): ZoneInfo {
    const header = this.parseHeader()
    const { stringCount, assetCount, assets } = this.parseAssets()
    return { header, stringCount, assetCount, assets }
  }
}
