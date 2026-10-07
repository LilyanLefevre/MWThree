// IWi v8 image files (MW2/MW3): 32-byte header followed by the mip chain.
import { decodeDxt, dxtBlockBytes, type DxtKind } from './Dxt.js'

export interface IwiImage {
  width: number
  height: number
  /** RGBA8 of the top mip level */
  rgba: Uint8Array
  format: number
  /** original flags (bit layout is not interpreted yet) */
  flags: number
  /** number of mip levels at or below the decoded one */
  mipCount: number
}

const FORMATS: Record<number, { kind: 'dxt'; dxt: DxtKind } | { kind: 'raw'; bpp: number }> = {
  0x01: { kind: 'raw', bpp: 4 }, // ARGB32
  0x02: { kind: 'raw', bpp: 3 }, // RGB24
  0x03: { kind: 'raw', bpp: 2 }, // GA16
  0x04: { kind: 'raw', bpp: 1 }, // A8
  0x0b: { kind: 'dxt', dxt: 'dxt1' },
  0x0c: { kind: 'dxt', dxt: 'dxt3' },
  0x0d: { kind: 'dxt', dxt: 'dxt5' },
}

/**
 * Decode an IWi image to RGBA8. Mip levels are stored smallest first (the top mip is last);
 * `maxSize` picks the largest level whose sides are both <= maxSize (to bound memory).
 */
export function parseIwi(data: Uint8Array, maxSize = Infinity): IwiImage {
  if (data[0] !== 0x49 || data[1] !== 0x57 || data[2] !== 0x69) throw new Error('not an IWi file')
  if (data[3] !== 8) throw new Error(`unsupported IWi version ${data[3]}`)
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const flags = dv.getUint32(4, true)
  const format = data[8]
  const topW = dv.getUint16(10, true), topH = dv.getUint16(12, true)
  const f = FORMATS[format]
  if (!f) throw new Error(`unsupported IWi format 0x${format.toString(16)}`)
  const levelBytes = (w: number, h: number) =>
    f.kind === 'dxt' ? Math.max(1, (w + 3) >> 2) * Math.max(1, (h + 3) >> 2) * dxtBlockBytes(f.dxt) : w * h * f.bpp

  // levels from the top (index 0) down to 1x1
  const levels: { w: number; h: number; bytes: number }[] = []
  for (let w = topW, h = topH; ; w = Math.max(1, w >> 1), h = Math.max(1, h >> 1)) {
    levels.push({ w, h, bytes: levelBytes(w, h) })
    if (w === 1 && h === 1) break
  }
  let pick = 0
  while (pick < levels.length - 1 && (levels[pick].w > maxSize || levels[pick].h > maxSize)) pick++
  // storage order is smallest -> largest: the offset of a level is the sum of all smaller levels
  let offset = 32
  for (let i = levels.length - 1; i > pick; i--) offset += levels[i].bytes
  const { w: width, h: height, bytes } = levels[pick]
  if (offset + bytes > data.length) throw new Error('truncated IWi file')
  const src = data.subarray(offset, offset + bytes)

  let rgba: Uint8Array
  if (f.kind === 'dxt') rgba = decodeDxt(src, width, height, f.dxt)
  else {
    rgba = new Uint8Array(width * height * 4)
    for (let i = 0; i < width * height; i++) {
      const s = i * f.bpp, o = i * 4
      if (f.bpp === 4) { rgba[o] = src[s + 2]; rgba[o + 1] = src[s + 1]; rgba[o + 2] = src[s]; rgba[o + 3] = src[s + 3] }
      else if (f.bpp === 3) { rgba[o] = src[s + 2]; rgba[o + 1] = src[s + 1]; rgba[o + 2] = src[s]; rgba[o + 3] = 255 }
      else if (f.bpp === 2) { rgba[o] = rgba[o + 1] = rgba[o + 2] = src[s]; rgba[o + 3] = src[s + 1] }
      else { rgba[o] = rgba[o + 1] = rgba[o + 2] = 255; rgba[o + 3] = src[s] }
    }
  }
  return { width, height, rgba, format, flags, mipCount: levels.length - pick }
}
