import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as pako from 'pako'
import { FastFileLoader } from './FastFileLoader.js'

function createTestFF(): ArrayBuffer {
  // Construit un .ff synthétique valide (format MW3: IWff0100)
  // 8 bytes magic "IWff0100" + 4 bytes version (1)
  // puis blocs zlib : uint16 size + data

  const payload = new TextEncoder().encode('Hello MW3 Zone!')
  const compressed = pako.deflate(payload)

  const buf = new ArrayBuffer(12 + 2 + compressed.length)
  const view = new DataView(buf)

  // Magic "IWff0100" (offset 0-7)
  const magic = [0x49, 0x57, 0x66, 0x66, 0x30, 0x31, 0x30, 0x30] // IWff0100
  for (let i = 0; i < 8; i++) view.setUint8(i, magic[i])

  // Version (offset 8-11)
  view.setUint32(8, 1, true)

  // Block size (offset 12-13)
  view.setUint16(12, compressed.length, true)

  // Compressed payload (offset 14+)
  new Uint8Array(buf, 14).set(compressed)

  return buf
}

function createTestFFRawMagic(): ArrayBuffer {
  // Même chose mais avec magic "XXXXXXXX" pour test d'erreur
  const buf = new ArrayBuffer(12)
  for (let i = 0; i < 8; i++) new DataView(buf).setUint8(i, 0x58) // 'X' * 8
  new DataView(buf).setUint32(8, 1, true)
  return buf
}

describe('FastFileLoader', () => {
  it('devrait charger un .ff synthétique valide (IWff0100)', () => {
    const buf = createTestFF()
    console.log('test FF size:', buf.byteLength)
    const loader = new FastFileLoader(buf)
    const zone = loader.load()
    const text = new TextDecoder().decode(new Uint8Array(zone))
    expect(text).toBe('Hello MW3 Zone!')
  })

  it('devrait rejeter un buffer vide', () => {
    const loader = new FastFileLoader(new ArrayBuffer(0))
    expect(() => loader.load()).toThrow(/trop petit/)
  })

  it('devrait rejeter un magic inconnu', () => {
    const loader = new FastFileLoader(createTestFFRawMagic())
    expect(() => loader.load()).toThrow(/magic non reconnu/)
  })

  it.skip('besoin recherche : mp_seatown.ff (IW4x)', () => {
    const seatownPath = resolve(
      import.meta.dirname, '..', '..', '..', 'inputs', 'mp_seatown', 'mp_seatown.ff'
    )
    const buffer = readFileSync(seatownPath).buffer
    const loader = new FastFileLoader(buffer)
    const zone = loader.load()
    expect(zone.byteLength).toBeGreaterThan(0)
    expect(zone.byteLength).toBeGreaterThan(buffer.byteLength)
  })
})
