import { describe, it, expect } from 'vitest'
import * as pako from 'pako'
import { FastFileLoader } from './FastFileLoader.js'

function makeHeaderBytes(magic: string, version = 1): Uint8Array {
  const buf = new Uint8Array(12)
  const enc = new TextEncoder()
  buf.set(enc.encode(magic), 0)
  const dv = new DataView(buf.buffer)
  dv.setUint32(8, version, true)
  return buf
}

function makePrefix(): Uint8Array {
  return new Uint8Array(9)
}

function makeAuthHeader(): Uint8Array {
  return new Uint8Array(0x4000)
}

function buildSignedFF(payload: Uint8Array, version = 1): ArrayBuffer {
  const header = makeHeaderBytes('IWff0100', version)
  const prefix = makePrefix()
  const auth = makeAuthHeader()
  const compressed = pako.deflate(payload)

  const total = header.length + prefix.length + auth.length + compressed.length
  const buf = new Uint8Array(total)
  buf.set(header)
  buf.set(prefix, header.length)
  buf.set(auth, header.length + prefix.length)
  buf.set(compressed, header.length + prefix.length + auth.length)

  return buf.buffer
}

function buildUnsignedFF(payload: Uint8Array, version = 1): ArrayBuffer {
  const header = makeHeaderBytes('IWffu100', version)
  const prefix = makePrefix()
  const compressed = pako.deflate(payload)

  const total = header.length + prefix.length + compressed.length
  const buf = new Uint8Array(total)
  buf.set(header)
  buf.set(prefix, header.length)
  buf.set(compressed, header.length + prefix.length)

  return buf.buffer
}

describe('FastFileLoader', () => {
  it('devrait decompresser un FF signe (IWff0100)', () => {
    const payload = new TextEncoder().encode('Zone data signed!')
    const buf = buildSignedFF(payload)
    const loader = new FastFileLoader(buf)
    const zone = loader.load()
    const text = new TextDecoder().decode(new Uint8Array(zone))
    expect(text).toBe('Zone data signed!')
  })

  it('devrait decompresser un FF non signe (IWffu100)', () => {
    const payload = new TextEncoder().encode('Zone data unsigned!')
    const buf = buildUnsignedFF(payload)
    const loader = new FastFileLoader(buf)
    const zone = loader.load()
    const text = new TextDecoder().decode(new Uint8Array(zone))
    expect(text).toBe('Zone data unsigned!')
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

  it('devrait rejeter un FF signe trop petit', () => {
    const buf = new ArrayBuffer(100)
    const header = makeHeaderBytes('IWff0100')
    new Uint8Array(buf).set(header)
    const loader = new FastFileLoader(buf)
    expect(() => loader.load()).toThrow(/trop petit/)
  })

  it('devrait rejeter un FF non signe trop petit', () => {
    const buf = new ArrayBuffer(15)
    const header = makeHeaderBytes('IWffu100')
    new Uint8Array(buf).set(header)
    const loader = new FastFileLoader(buf)
    expect(() => loader.load()).toThrow(/trop petit/)
  })
})
