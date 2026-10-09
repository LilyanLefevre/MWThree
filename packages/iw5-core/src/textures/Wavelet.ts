// IWi "wavelet" images (formats 6-10): Haar wavelet + Huffman, decoded from the 1x1 level up.
// Port of OpenAssetTools' IwiWaveletDecoder.cpp (MIT), codeword tables included verbatim.

const LOOKUP_BITS = 12
const ESCAPE = -32768

// [code (LSB first), bit count, value]
// prettier-ignore
const BLUE: [number, number, number][] = [
  [0x001,3,0],[0x004,5,4],[0x005,5,2],[0x007,5,1],[0x00A,5,3],[0x014,5,-4],[0x015,5,-2],[0x017,5,-1],[0x01A,5,-3],[0x000,6,12],[0x002,6,10],[0x003,6,7],
  [0x006,6,9],[0x00B,6,6],[0x018,6,11],[0x01E,6,8],[0x01F,6,5],[0x020,6,-12],[0x022,6,-10],[0x023,6,-7],[0x026,6,-9],[0x02B,6,-6],[0x038,6,-11],[0x03C,6,ESCAPE],
  [0x03E,6,-8],[0x03F,6,-5],[0x00F,7,13],[0x012,7,19],[0x016,7,18],[0x01B,7,14],[0x028,7,21],[0x02C,7,20],[0x02D,7,16],[0x02E,7,17],[0x030,7,22],[0x03D,7,15],
  [0x04F,7,-13],[0x052,7,-19],[0x056,7,-18],[0x05B,7,-14],[0x068,7,-21],[0x06C,7,-20],[0x06D,7,-16],[0x06E,7,-17],[0x070,7,-22],[0x07D,7,-15],[0x008,8,34],[0x00D,8,28],
  [0x00E,8,29],[0x013,8,26],[0x01D,8,27],[0x02F,8,23],[0x033,8,25],[0x03B,8,24],[0x048,8,33],[0x04C,8,32],[0x05C,8,31],[0x072,8,30],[0x088,8,-34],[0x08D,8,-28],
  [0x08E,8,-29],[0x093,8,-26],[0x09D,8,-27],[0x0AF,8,-23],[0x0B3,8,-25],[0x0BB,8,-24],[0x0C8,8,-33],[0x0CC,8,-32],[0x0DC,8,-31],[0x0F2,8,-30],[0x00C,9,47],[0x01C,9,46],
  [0x032,9,45],[0x036,9,44],[0x050,9,48],[0x076,9,43],[0x07B,9,37],[0x090,9,49],[0x0CD,9,40],[0x0CE,9,41],[0x0D3,9,38],[0x0DD,9,39],[0x0EF,9,35],[0x0F6,9,42],
  [0x0FB,9,36],[0x10C,9,-47],[0x11C,9,-46],[0x132,9,-45],[0x136,9,-44],[0x150,9,-48],[0x176,9,-43],[0x17B,9,-37],[0x190,9,-49],[0x1CD,9,-40],[0x1CE,9,-41],[0x1D3,9,-38],
  [0x1DD,9,-39],[0x1EF,9,-35],[0x1F6,9,-42],[0x1FB,9,-36],[0x010,10,65],[0x04D,10,56],[0x04E,10,57],[0x05D,10,55],[0x08C,10,62],[0x09C,10,61],[0x110,10,64],[0x153,10,53],
  [0x15D,10,54],[0x16F,10,50],[0x173,10,52],[0x19C,10,60],[0x1B2,10,59],[0x1B6,10,58],[0x1D0,10,63],[0x1F3,10,51],[0x210,10,-65],[0x24D,10,-56],[0x24E,10,-57],[0x25D,10,-55],
  [0x28C,10,-62],[0x29C,10,-61],[0x310,10,-64],[0x353,10,-53],[0x35D,10,-54],[0x36F,10,-50],[0x373,10,-52],[0x39C,10,-60],[0x3B2,10,-59],[0x3B6,10,-58],[0x3D0,10,-63],[0x3F3,10,-51],
  [0x053,11,70],[0x06F,11,66],[0x073,11,69],[0x0B2,11,77],[0x0B6,11,75],[0x0D0,11,81],[0x14E,11,73],[0x18C,11,79],[0x273,11,68],[0x2B2,11,76],[0x2B6,11,74],[0x2D0,11,80],
  [0x2F3,11,67],[0x34D,11,71],[0x34E,11,72],[0x38C,11,78],[0x453,11,-70],[0x46F,11,-66],[0x473,11,-69],[0x4B2,11,-77],[0x4B6,11,-75],[0x4D0,11,-81],[0x54E,11,-73],[0x58C,11,-79],
  [0x673,11,-68],[0x6B2,11,-76],[0x6B6,11,-74],[0x6D0,11,-80],[0x6F3,11,-67],[0x74D,11,-71],[0x74E,11,-72],[0x78C,11,-78],[0x0F3,12,85],[0x14D,12,89],[0x253,12,87],[0x26F,12,83],
  [0x4F3,12,84],[0x54D,12,88],[0x653,12,86],[0x66F,12,82],[0x8F3,12,-85],[0x94D,12,-89],[0xA53,12,-87],[0xA6F,12,-83],[0xCF3,12,-84],[0xD4D,12,-88],[0xE53,12,-86],[0xE6F,12,-82],
]
// prettier-ignore
const RED_GREEN: [number, number, number][] = [
  [0x003,2,0],[0x002,3,1],[0x006,3,-1],[0x001,4,2],[0x009,4,-2],[0x004,5,4],[0x00D,5,3],[0x014,5,-4],[0x01D,5,-3],[0x00C,6,6],[0x010,6,7],[0x015,6,5],
  [0x02C,6,-6],[0x030,6,-7],[0x035,6,-5],[0x018,7,10],[0x01C,7,9],[0x020,7,11],[0x025,7,8],[0x058,7,-10],[0x05C,7,-9],[0x060,7,-11],[0x065,7,-8],[0x068,7,ESCAPE],
  [0x038,8,14],[0x040,8,16],[0x045,8,12],[0x048,8,15],[0x07C,8,13],[0x0B8,8,-14],[0x0C0,8,-16],[0x0C5,8,-12],[0x0C8,8,-15],[0x0FC,8,-13],[0x080,9,22],[0x085,9,17],
  [0x088,9,21],[0x0A8,9,20],[0x0BC,9,18],[0x0F8,9,19],[0x180,9,-22],[0x185,9,-17],[0x188,9,-21],[0x1A8,9,-20],[0x1BC,9,-18],[0x1F8,9,-19],[0x000,10,30],[0x03C,10,25],
  [0x078,10,26],[0x100,10,29],[0x105,10,23],[0x108,10,28],[0x128,10,27],[0x13C,10,24],[0x200,10,-30],[0x23C,10,-25],[0x278,10,-26],[0x300,10,-29],[0x305,10,-23],[0x308,10,-28],
  [0x328,10,-27],[0x33C,10,-24],[0x005,11,31],[0x008,11,37],[0x028,11,35],[0x178,11,33],[0x208,11,36],[0x228,11,34],[0x378,11,32],[0x405,11,-31],[0x408,11,-37],[0x428,11,-35],
  [0x578,11,-33],[0x608,11,-36],[0x628,11,-34],[0x778,11,-32],[0x205,12,39],[0x605,12,38],[0xA05,12,-39],[0xE05,12,-38],
]
// prettier-ignore
const ALPHA: [number, number, number][] = [
  [0x001,1,0],[0x000,4,ESCAPE],[0x002,4,1],[0x00A,4,-1],[0x00C,5,2],[0x01C,5,-2],[0x016,6,3],[0x018,6,4],[0x036,6,-3],[0x038,6,-4],[0x004,7,7],[0x02E,7,5],[0x034,7,6],[0x044,7,-7],
  [0x06E,7,-5],[0x074,7,-6],[0x006,8,11],[0x008,8,14],[0x014,8,12],[0x01E,8,9],[0x048,8,15],[0x066,8,10],[0x068,8,13],[0x07E,8,8],[0x086,8,-11],[0x088,8,-14],[0x094,8,-12],[0x09E,8,-9],
  [0x0C8,8,-15],[0x0E6,8,-10],[0x0E8,8,-13],[0x0FE,8,-8],[0x028,9,23],[0x046,9,19],[0x054,9,20],[0x08E,9,17],[0x0A4,9,22],[0x0A8,9,24],[0x0C6,9,18],[0x0DE,9,16],[0x0E4,9,21],[0x128,9,-23],
  [0x146,9,-19],[0x154,9,-20],[0x18E,9,-17],[0x1A4,9,-22],[0x1A8,9,-24],[0x1C6,9,-18],[0x1DE,9,-16],[0x1E4,9,-21],[0x00E,10,29],[0x024,10,37],[0x026,10,31],[0x04E,10,28],[0x064,10,35],[0x0BE,10,32],
  [0x0D4,10,33],[0x124,10,36],[0x126,10,30],[0x13E,10,25],[0x15E,10,26],[0x164,10,34],[0x1A6,10,127],[0x1CE,10,27],[0x1D4,10,128],[0x20E,10,-29],[0x224,10,-37],[0x226,10,-31],[0x24E,10,-28],[0x264,10,-35],
  [0x2BE,10,-32],[0x2D4,10,-33],[0x324,10,-36],[0x326,10,-30],[0x33E,10,-25],[0x35E,10,-26],[0x364,10,-34],[0x3A6,10,-127],[0x3CE,10,-27],[0x3D4,10,-128],[0x03E,11,41],[0x05E,11,43],[0x0A6,11,50],[0x0CE,11,48],
  [0x10E,11,49],[0x14E,11,64],[0x1BE,11,39],[0x23E,11,40],[0x25E,11,42],[0x2A6,11,47],[0x2CE,11,44],[0x30E,11,46],[0x34E,11,45],[0x3BE,11,38],[0x43E,11,-41],[0x45E,11,-43],[0x4A6,11,-50],[0x4CE,11,-48],
  [0x50E,11,-49],[0x54E,11,-64],[0x5BE,11,-39],[0x63E,11,-40],[0x65E,11,-42],[0x6A6,11,-47],[0x6CE,11,-44],[0x70E,11,-46],[0x74E,11,-45],[0x7BE,11,-38],
]

/** 4096-entry tables indexed by the next 12 bits: value << 8 | bit count. */
function lookup(codewords: [number, number, number][]): Int32Array {
  const t = new Int32Array(1 << LOOKUP_BITS)
  for (const [code, bits, value] of codewords) for (let i = code; i < t.length; i += 1 << bits) t[i] = value * 256 + bits
  return t
}
let tables: { blue: Int32Array; rg: Int32Array; alpha: Int32Array } | null = null

class BitReader {
  private byte = 0
  private bit = -1 // -1 until the first bit read: the 1x1 levels are plain bytes before the bit stream
  constructor(private data: Uint8Array) {}
  rawByte(): number {
    if (this.bit >= 0 || this.byte >= this.data.length) throw new Error('truncated wavelet data')
    return this.data[this.byte++]
  }
  peek(n: number): number {
    if (this.bit < 0) this.bit = this.byte * 8
    let v = 0
    for (let i = 0, b = this.bit; i < n; i++, b++) v |= ((this.data[b >> 3] ?? 0) >> (b & 7) & 1) << i
    return v
  }
  read(n: number): number {
    const v = this.peek(n)
    this.bit += n
    if (this.bit > this.data.length * 8) throw new Error('truncated wavelet data')
    return v
  }
  value(table: Int32Array, escapeBits: number, escapeBias: number): number {
    const e = table[this.peek(LOOKUP_BITS)]
    this.read(e & 255)
    const v = e >> 8
    return v === ESCAPE ? this.read(escapeBits) - escapeBias : v
  }
}

/** Channels per format (6 RGBA, 7 RGB, 8 luminance+alpha, 9 luminance, 10 alpha) and bytes per decoded pixel. */
const LAYOUT: Record<number, { channels: number; bpp: number }> = {
  6: { channels: 4, bpp: 4 }, 7: { channels: 3, bpp: 4 }, 8: { channels: 2, bpp: 2 }, 9: { channels: 1, bpp: 1 }, 10: { channels: 1, bpp: 1 },
}

/**
 * Decode the whole mip chain of a wavelet IWi (`data` = everything after the 32-byte header).
 * Returns the levels largest first, in the engine's channel order (B, G, R, A for RGB/RGBA).
 */
export function decodeWaveletMips(data: Uint8Array, width: number, height: number, format: number): { width: number; height: number; pixels: Uint8Array; bpp: number }[] {
  const layout = LAYOUT[format]
  if (!layout) throw new Error(`not a wavelet IWi format: ${format}`)
  tables ??= { blue: lookup(BLUE), rg: lookup(RED_GREEN), alpha: lookup(ALPHA) }
  const { blue, rg, alpha } = tables
  const { channels, bpp } = layout
  const sizes: [number, number][] = []
  for (let w = width, h = height; ; w = Math.max(1, w >> 1), h = Math.max(1, h >> 1)) { sizes.push([w, h]); if (w === 1 && h === 1) break }
  const r = new BitReader(data)
  const out: { width: number; height: number; pixels: Uint8Array; bpp: number }[] = []
  let source: Uint8Array | null = null
  const coef = [0, 0, 0], blueCoef = [0, 0, 0]
  for (let level = sizes.length - 1; level >= 0; level--) {
    const [w, h] = sizes[level]
    const dst = new Uint8Array(w * h * bpp)
    if (w <= 1 || h <= 1) {
      for (let p = 0; p < w * h; p++) {
        for (let c = 0; c < channels; c++) dst[p * bpp + c] = r.rawByte()
        for (let c = channels; c < bpp; c++) dst[p * bpp + c] = 255
      }
    } else {
      let src = source!
      if (r.read(1)) { // the smaller level is refined by a per-texel delta first
        src = src.slice()
        for (let p = 0; p < (w * h) >> 2; p++) for (let c = 0; c < channels; c++) src[p * bpp + c] = (src[p * bpp + c] + r.value(alpha, 9, 255)) & 255
      }
      const stride = w * bpp
      const reconstruct = (s: number, d: number, c: number, parity: number, k: number[]) => {
        const base = 2 * src[s + c], hz = k[0], v = k[1], dg = k[2]
        dst[d + c] = (parity + ((dg + v + hz + base) >> 1)) & 255
        dst[d + bpp + c] = ((hz + base - dg - v) >> 1) & 255
        dst[d + stride + c] = ((v - dg + base - hz) >> 1) & 255
        dst[d + stride + bpp + c] = ((base - hz - v + dg) >> 1) & 255
      }
      for (let y = 0; y < h; y += 2) {
        for (let x = 0; x < w; x += 2) {
          const s = ((y >> 1) * (w >> 1) + (x >> 1)) * bpp, d = (y * w + x) * bpp
          if (channels !== 1) {
            const parity = r.read(1)
            for (let i = 0; i < 3; i++) blueCoef[i] = r.value(blue, 9, 0xff)
            reconstruct(s, d, 0, parity, blueCoef)
            if (channels >= 3) {
              for (let c = 1; c <= 2; c++) {
                const p = r.read(1)
                for (let i = 0; i < 3; i++) coef[i] = r.value(rg, 10, 0x1fe) + blueCoef[i]
                reconstruct(s, d, c, p, coef)
              }
            }
          }
          if (channels === 3) {
            dst[d + 3] = dst[d + bpp + 3] = dst[d + stride + 3] = dst[d + stride + bpp + 3] = 255
          } else {
            const p = r.read(1)
            for (let i = 0; i < 3; i++) coef[i] = r.value(alpha, 9, 0xff)
            reconstruct(s, d, channels - 1, p, coef)
          }
        }
      }
    }
    out.unshift({ width: w, height: h, pixels: dst, bpp })
    source = dst
  }
  return out
}
