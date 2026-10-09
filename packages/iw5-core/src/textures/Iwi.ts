// IWi v8 image files (MW2/MW3): 32-byte header followed by the mip chain.
import { decodeDxt, dxtBlockBytes, type DxtKind } from './Dxt.js'
import { decodeWaveletMips } from './Wavelet.js'

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

// IwiFormat (OpenAssetTools IwiTypes.h, iwi8); 0x06-0x0a are wavelet-compressed (Wavelet.ts)
const FORMATS: Record<number, { kind: 'dxt'; dxt: DxtKind } | { kind: 'raw'; bpp: number; alpha?: boolean }> = {
  0x01: { kind: 'raw', bpp: 4 }, // BGRA
  0x02: { kind: 'raw', bpp: 3 }, // BGR
  0x03: { kind: 'raw', bpp: 2 }, // luminance + alpha
  0x04: { kind: 'raw', bpp: 1 }, // luminance
  0x05: { kind: 'raw', bpp: 1, alpha: true }, // alpha
  0x0b: { kind: 'dxt', dxt: 'dxt1' },
  0x0c: { kind: 'dxt', dxt: 'dxt3' },
  0x0d: { kind: 'dxt', dxt: 'dxt5' },
}

/**
 * Decode an IWi image to RGBA8. Mip levels are stored smallest first (the top mip is last);
 * `maxSize` picks the largest level whose sides are both <= maxSize (to bound memory).
 */
export function parseIwi(data: Uint8Array, maxSize = Infinity, asNormalMap = false): IwiImage {
  if (data[0] !== 0x49 || data[1] !== 0x57 || data[2] !== 0x69) throw new Error('not an IWi file')
  if (data[3] !== 8) throw new Error(`unsupported IWi version ${data[3]}`)
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const flags = dv.getUint32(4, true)
  const format = data[8]
  const topW = dv.getUint16(10, true), topH = dv.getUint16(12, true)
  if (format >= 0x06 && format <= 0x0a) return parseWaveletIwi(data, format, flags, topW, topH, maxSize, asNormalMap)
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
      else if (f.alpha) { rgba[o] = rgba[o + 1] = rgba[o + 2] = 255; rgba[o + 3] = src[s] }
      else { rgba[o] = rgba[o + 1] = rgba[o + 2] = src[s]; rgba[o + 3] = 255 }
    }
  }
  if (asNormalMap) toNormalMap(rgba)
  return { width, height, rgba, format, flags, mipCount: levels.length - pick }
}

/** Wavelet formats: the whole chain is decoded from 1x1 up, then the largest level <= maxSize is kept. */
function parseWaveletIwi(data: Uint8Array, format: number, flags: number, topW: number, topH: number, maxSize: number, asNormalMap: boolean): IwiImage {
  const levels = decodeWaveletMips(data.subarray(32), topW, topH, format)
  let pick = 0
  while (pick < levels.length - 1 && (levels[pick].width > maxSize || levels[pick].height > maxSize)) pick++
  const { width, height, pixels: p, bpp } = levels[pick]
  const rgba = new Uint8Array(width * height * 4)
  for (let i = 0, s = 0, o = 0; i < width * height; i++, s += bpp, o += 4) {
    if (bpp === 4) { rgba[o] = p[s + 2]; rgba[o + 1] = p[s + 1]; rgba[o + 2] = p[s]; rgba[o + 3] = p[s + 3] }
    else if (bpp === 2) { rgba[o] = rgba[o + 1] = rgba[o + 2] = p[s]; rgba[o + 3] = p[s + 1] }
    else if (format === 0x0a) { rgba[o] = rgba[o + 1] = rgba[o + 2] = 255; rgba[o + 3] = p[s] }
    else { rgba[o] = rgba[o + 1] = rgba[o + 2] = p[s]; rgba[o + 3] = 255 }
  }
  if (asNormalMap) toNormalMap(rgba)
  return { width, height, rgba, format, flags, mipCount: levels.length - pick }
}

/**
 * IW normal maps are DXT5nm: X in alpha, Y in green, Z implicit. Rewrite them in place as a regular
 * RGB tangent-space map (the green channel is flipped: the game uses a Y-down convention).
 */
export function toNormalMap(rgba: Uint8Array): void {
  for (let i = 0; i < rgba.length; i += 4) {
    const x = rgba[i + 3] / 127.5 - 1, y = rgba[i + 1] / 127.5 - 1
    const z = Math.sqrt(Math.max(0, 1 - x * x - y * y))
    rgba[i] = (x * 0.5 + 0.5) * 255
    rgba[i + 1] = (-y * 0.5 + 0.5) * 255
    rgba[i + 2] = (z * 0.5 + 0.5) * 255
    rgba[i + 3] = 255
  }
}

/**
 * Cube maps (skies) store 6 faces of the top level only: 32-byte header + 6 x level bytes,
 * in D3D face order (+X, -X, +Y, -Y, +Z, -Z). Returns null for non-cube files.
 */
export function parseIwiCube(data: Uint8Array): IwiImage[] | null {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const format = data[8]
  const w = dv.getUint16(10, true), h = dv.getUint16(12, true)
  const f = FORMATS[format]
  if (!f) return null
  const face = f.kind === 'dxt' ? Math.max(1, (w + 3) >> 2) * Math.max(1, (h + 3) >> 2) * dxtBlockBytes(f.dxt) : w * h * f.bpp
  if (data.length !== 32 + 6 * face || f.kind !== 'dxt') return null
  const faces: IwiImage[] = []
  for (let i = 0; i < 6; i++) {
    const rgba = decodeDxt(data.subarray(32 + i * face, 32 + (i + 1) * face), w, h, f.dxt)
    faces.push({ width: w, height: h, rgba, format, flags: dv.getUint32(4, true), mipCount: 1 })
  }
  return faces
}

/**
 * Resample a cube map (D3D face layout, game axes: Z up) to an equirectangular image laid out the way
 * three.js samples it (EquirectangularReflectionMapping): row 0 is the bottom (looking down),
 * u = atan2(z, x) / 2π + 0.5 in scene axes (Y up; scene = (x, z, -y) of the game).
 */
export function cubeToEquirect(faces: IwiImage[], width = 2048, height = 1024): Uint8Array {
  const out = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const lat = ((y + 0.5) / height - 0.5) * Math.PI
    for (let x = 0; x < width; x++) {
      const phi = ((x + 0.5) / width - 0.5) * 2 * Math.PI
      const sx = Math.cos(lat) * Math.cos(phi), sy = Math.sin(lat), sz = Math.cos(lat) * Math.sin(phi)
      // scene (x, y, z) -> game (x, -z, y)
      const gx = sx, gy = -sz, gz = sy
      const ax = Math.abs(gx), ay = Math.abs(gy), az = Math.abs(gz)
      let face: number, sc: number, tc: number, ma: number
      if (ax >= ay && ax >= az) { ma = ax; face = gx > 0 ? 0 : 1; sc = gx > 0 ? -gz : gz; tc = -gy }
      else if (ay >= az) { ma = ay; face = gy > 0 ? 2 : 3; sc = gx; tc = gy > 0 ? gz : -gz }
      else { ma = az; face = gz > 0 ? 4 : 5; sc = gz > 0 ? gx : -gx; tc = -gy }
      const f = faces[face]
      const u = Math.min(f.width - 1, Math.max(0, Math.floor((sc / ma + 1) / 2 * f.width)))
      const v = Math.min(f.height - 1, Math.max(0, Math.floor((tc / ma + 1) / 2 * f.height)))
      const src = (v * f.width + u) * 4, o = (y * width + x) * 4
      out[o] = f.rgba[src]; out[o + 1] = f.rgba[src + 1]; out[o + 2] = f.rgba[src + 2]; out[o + 3] = 255
    }
  }
  return out
}

export interface IwiMips {
  kind: DxtKind
  width: number
  height: number
  /** compressed levels from the chosen top level down to 1x1 (S3TC blocks, ready for the GPU) */
  mips: { width: number; height: number; data: Uint8Array }[]
  /** some texel is transparent (DXT1 punch-through or DXT3/5 alpha below 250) */
  hasAlpha: boolean
}

/** S3TC images without decoding: the mip chain from the largest level <= maxSize. Null for other formats. */
export function iwiCompressedMips(data: Uint8Array, maxSize = Infinity): IwiMips | null {
  if (data[0] !== 0x49 || data[1] !== 0x57 || data[2] !== 0x69 || data[3] !== 8) return null
  const f = FORMATS[data[8]]
  if (!f || f.kind !== 'dxt') return null
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const topW = dv.getUint16(10, true), topH = dv.getUint16(12, true)
  const bs = dxtBlockBytes(f.dxt)
  const levels: { width: number; height: number; bytes: number }[] = []
  for (let w = topW, h = topH; ; w = Math.max(1, w >> 1), h = Math.max(1, h >> 1)) {
    levels.push({ width: w, height: h, bytes: Math.max(1, (w + 3) >> 2) * Math.max(1, (h + 3) >> 2) * bs })
    if (w === 1 && h === 1) break
  }
  const total = 32 + levels.reduce((a, l) => a + l.bytes, 0)
  if (total > data.length) return null // not a full mip chain (cube maps, truncated files)
  let pick = 0
  while (pick < levels.length - 1 && (levels[pick].width > maxSize || levels[pick].height > maxSize)) pick++
  // stored smallest first: level i starts after every smaller level
  const offsets: number[] = new Array(levels.length)
  let off = 32
  for (let i = levels.length - 1; i >= 0; i--) { offsets[i] = off; off += levels[i].bytes }
  const mips = levels.slice(pick).map((l, k) => ({ width: l.width, height: l.height, data: data.slice(offsets[pick + k], offsets[pick + k] + l.bytes) }))
  return { kind: f.dxt, width: levels[pick].width, height: levels[pick].height, mips, hasAlpha: dxtHasAlpha(mips[0].data, f.dxt) }
}

function dxtHasAlpha(d: Uint8Array, kind: DxtKind): boolean {
  if (kind === 'dxt1') {
    for (let p = 0; p < d.length; p += 8) {
      const c0 = d[p] | (d[p + 1] << 8), c1 = d[p + 2] | (d[p + 3] << 8)
      if (c0 > c1) continue
      for (let k = 4; k < 8; k++) { const b = d[p + k]; if ((b & 3) === 3 || (b >> 2 & 3) === 3 || (b >> 4 & 3) === 3 || (b >> 6) === 3) return true }
    }
    return false
  }
  if (kind === 'dxt3') {
    for (let p = 0; p < d.length; p += 16) for (let k = 0; k < 8; k++) if (d[p + k] !== 0xff) return true
    return false
  }
  for (let p = 0; p < d.length; p += 16) if (Math.min(d[p], d[p + 1]) < 250) return true
  return false
}
