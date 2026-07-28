import { describe, it, expect } from 'vitest'
import * as pako from 'pako'
import { FastFileLoader } from './FastFileLoader.js'

function createTestFF(): ArrayBuffer {
  const payload = new TextEncoder().encode('Hello MW3 Zone!')
  const compressed = pako.deflate(payload)

  const buf = new ArrayBuffer(12 + compressed.length)
  const view = new DataView(buf)

  const magic = [0x49, 0x57, 0x66, 0x66, 0x30, 0x31, 0x30, 0x30]
  for (let i = 0; i < 8; i++) view.setUint8(i, magic[i])
  view.setUint32(8, 1, true)
  new Uint8Array(buf, 12).set(compressed)

  return buf
}

describe('FastFileLoader', () => {
  it('devrait décompresser un flux zlib brut (raw_zlib)', () => {
    const buf = createTestFF()
    const loader = new FastFileLoader(buf)
    const zone = loader.load()
    const text = new TextDecoder().decode(new Uint8Array(zone))
    expect(text).toBe('Hello MW3 Zone!')
  })

  it('devrait décompresser avec blocs uint16', () => {
    const payload = new TextEncoder().encode('Blocs uint16!')
    const compressed = pako.deflate(payload)
    const buf = new ArrayBuffer(12 + 2 + compressed.length)
    const view = new DataView(buf)

    const magic = [0x49, 0x57, 0x66, 0x66, 0x30, 0x31, 0x30, 0x30]
    for (let i = 0; i < 8; i++) view.setUint8(i, magic[i])
    view.setUint32(8, 1, true)
    view.setUint16(12, compressed.length, true)
    new Uint8Array(buf, 14).set(compressed)

    const loader = new FastFileLoader(buf)
    const zone = loader.load()
    expect(new TextDecoder().decode(new Uint8Array(zone))).toBe('Blocs uint16!')
  })

  it('devrait décompresser avec blocs uint32', () => {
    const payload = new TextEncoder().encode('Blocs uint32!')
    const compressed = pako.deflate(payload)
    const buf = new ArrayBuffer(12 + 4 + compressed.length)
    const view = new DataView(buf)

    const magic = [0x49, 0x57, 0x66, 0x66, 0x30, 0x31, 0x30, 0x30]
    for (let i = 0; i < 8; i++) view.setUint8(i, magic[i])
    view.setUint32(8, 1, true)
    view.setUint32(12, compressed.length, true)
    new Uint8Array(buf, 16).set(compressed)

    const loader = new FastFileLoader(buf)
    const zone = loader.load()
    expect(new TextDecoder().decode(new Uint8Array(zone))).toBe('Blocs uint32!')
  })

  it('devrait rejeter un buffer vide', () => {
    const loader = new FastFileLoader(new ArrayBuffer(0))
    expect(() => loader.load()).toThrow(/trop petit/)
  })

  it('devrait rejeter un magic inconnu', () => {
    const buf = new ArrayBuffer(12)
    for (let i = 0; i < 8; i++) new DataView(buf).setUint8(i, 0x58)
    new DataView(buf).setUint32(8, 1, true)
    const loader = new FastFileLoader(buf)
    expect(() => loader.load()).toThrow(/magic non reconnu/)
  })
})
