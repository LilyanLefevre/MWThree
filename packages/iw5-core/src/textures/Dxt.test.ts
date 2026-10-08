import { describe, it, expect } from 'vitest'
import { decodeDxt } from './Dxt.js'
import { iwiCompressedMips, parseIwi } from './Iwi.js'

describe('decodeDxt', () => {
  it('decodes a solid DXT1 block', () => {
    // color0 = pure red (565: 0xF800), color1 = black, all indices 0 -> color0
    const block = new Uint8Array([0x00, 0xf8, 0x00, 0x00, 0, 0, 0, 0])
    const rgba = decodeDxt(block, 4, 4, 'dxt1')
    expect([...rgba.subarray(0, 4)]).toEqual([255, 0, 0, 255])
    expect([...rgba.subarray(60, 64)]).toEqual([255, 0, 0, 255])
  })

  it('decodes DXT5 alpha', () => {
    const block = new Uint8Array(16)
    block[0] = 200; block[1] = 100 // alpha endpoints, indices 0 -> alpha0
    block[8] = 0x00; block[9] = 0xf8 // color0 red
    const rgba = decodeDxt(block, 4, 4, 'dxt5')
    expect(rgba[3]).toBe(200)
  })
})

describe('parseIwi', () => {
  it('reads the top mip from the end of the mip chain and honours maxSize', () => {
    // 2x2 A8 image: mips are 1x1 (value 7) then 2x2 (values 1..4)
    const header = new Uint8Array(32)
    header.set([0x49, 0x57, 0x69, 8], 0)
    header[8] = 0x04 // A8
    header[10] = 2; header[12] = 2; header[14] = 1
    const body = new Uint8Array([7, 1, 2, 3, 4])
    const file = new Uint8Array([...header, ...body])
    const top = parseIwi(file)
    expect([top.width, top.height]).toEqual([2, 2])
    expect([top.rgba[3], top.rgba[7], top.rgba[11], top.rgba[15]]).toEqual([1, 2, 3, 4])
    const small = parseIwi(file, 1)
    expect([small.width, small.rgba[3]]).toEqual([1, 7])
  })
})

describe('iwiCompressedMips', () => {
  it('returns the S3TC mip chain from the chosen level down to 1x1', () => {
    // 8x8 DXT1: levels 8x8 (4 blocks), 4x4, 2x2, 1x1 (1 block each), stored smallest first
    const header = new Uint8Array(32)
    header.set([0x49, 0x57, 0x69, 8], 0)
    header[8] = 0x0b
    header[10] = 8; header[12] = 8; header[14] = 1
    const block = (v: number) => [v, 0, 0, 0, 0, 0, 0, 0] // c0 > c1: opaque
    const body = [...block(1), ...block(2), ...block(3), ...block(4), ...block(4), ...block(4), ...block(4)]
    const m = iwiCompressedMips(new Uint8Array([...header, ...body]), 4)!
    expect(m.kind).toBe('dxt1')
    expect([m.width, m.height]).toEqual([4, 4])
    expect(m.mips.map(l => l.width)).toEqual([4, 2, 1])
    expect(m.mips[0].data[0]).toBe(3)
    expect(m.hasAlpha).toBe(false)
  })
})
