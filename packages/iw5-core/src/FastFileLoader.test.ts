import { describe, it, expect } from 'vitest'
import * as pako from 'pako'
import { zstdCompressSync } from 'node:zlib'
import { FastFileLoader } from './FastFileLoader.js'

const CHUNK_SIZE = 0x2000

function padToChunk(data: Uint8Array): Uint8Array {
  if (data.length >= CHUNK_SIZE) return data
  const padded = new Uint8Array(CHUNK_SIZE)
  padded.set(data)
  return padded
}

function buildSignedFF(payload: Uint8Array, version = 1): ArrayBuffer {
  const header = new Uint8Array(12)
  const enc = new TextEncoder()
  header.set(enc.encode('IWff0100'), 0)
  new DataView(header.buffer).setUint32(8, version, true)

  const prefix = new Uint8Array(9)
  const auth = new Uint8Array(0x2000)
  const compressed = pako.deflate(payload)

  const hashChunk = new Uint8Array(CHUNK_SIZE)
  const dataChunks: Uint8Array[] = []

  for (let off = 0; off < compressed.length; off += CHUNK_SIZE) {
    const chunk = compressed.subarray(off, off + CHUNK_SIZE)
    dataChunks.push(chunk.length < CHUNK_SIZE ? padToChunk(chunk) : chunk)
  }

  const parts = [header, prefix, auth, hashChunk, ...dataChunks]
  const total = parts.reduce((s, p) => s + p.length, 0)
  const buf = new Uint8Array(total)
  let pos = 0
  for (const p of parts) { buf.set(p, pos); pos += p.length }

  return buf.buffer
}

function buildUnsignedFF(payload: Uint8Array, version = 1): ArrayBuffer {
  const header = new Uint8Array(12)
  const enc = new TextEncoder()
  header.set(enc.encode('IWffu100'), 0)
  new DataView(header.buffer).setUint32(8, version, true)

  const prefix = new Uint8Array(9)
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

  it('devrait decompresser un FF signe avec donnees multi-chunks', () => {
    const payload = new Uint8Array(CHUNK_SIZE * 3)
    for (let i = 0; i < payload.length; i++) payload[i] = i & 0xFF
    const buf = buildSignedFF(payload)
    const loader = new FastFileLoader(buf)
    const zone = loader.load()
    expect(new Uint8Array(zone)).toEqual(payload)
  })

  it('devrait rejeter un buffer vide', () => {
    const loader = new FastFileLoader(new ArrayBuffer(0))
    expect(() => loader.load()).toThrow(/too small/)
  })

  it('devrait rejeter un magic inconnu', () => {
    const buf = new ArrayBuffer(12)
    for (let i = 0; i < 8; i++) new DataView(buf).setUint8(i, 0x58)
    new DataView(buf).setUint32(8, 1, true)
    const loader = new FastFileLoader(buf)
    expect(() => loader.load()).toThrow(/magic/)
  })

  it('devrait rejeter un FF signe trop petit', () => {
    const buf = new ArrayBuffer(100)
    const enc = new TextEncoder()
    new Uint8Array(buf).set(enc.encode('IWff0100'))
    const loader = new FastFileLoader(buf)
    expect(() => loader.load()).toThrow(/too small/)
  })

  it('devrait rejeter un FF non signe trop petit', () => {
    const buf = new ArrayBuffer(15)
    const enc = new TextEncoder()
    new Uint8Array(buf).set(enc.encode('IWffu100'))
    const loader = new FastFileLoader(buf)
    expect(() => loader.load()).toThrow(/too small/)
  })
})

describe('FastFileLoader (zstd)', () => {
  it('reads an unsigned FastFile compressed with Zstandard (custom-map linkers)', () => {
    const payload = new Uint8Array(5000).map((_, i) => (i * 7) & 0xff)
    const header = new Uint8Array(21)
    header.set(new TextEncoder().encode('IWffu100'), 0)
    new DataView(header.buffer).setUint32(8, 2000, true) // the version ZoneTool gives zstd zones
    const body = zstdCompressSync(payload)
    const file = new Uint8Array(header.length + body.length)
    file.set(header); file.set(body, header.length)
    expect(new Uint8Array(new FastFileLoader(file.buffer).load())).toEqual(payload)
  })
})
