import * as pako from 'pako'

export const SUPPORTED_MAGICS = ['IWff0100', 'IWffu100'] as const
export type FastFileMagic = typeof SUPPORTED_MAGICS[number]

export interface FastFileHeader {
  magic: FastFileMagic
  version: number
}

const HEADER_SIZE = 12
const PREFIX_SIZE = 9
const AUTH_HEADER_SIZE = 0x4000
const ZONE_OFFSET_UNSIGNED = HEADER_SIZE + PREFIX_SIZE
const ZONE_OFFSET_SIGNED = HEADER_SIZE + PREFIX_SIZE + AUTH_HEADER_SIZE

function bytesToArrayBuffer(data: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(data.length)
  new Uint8Array(ab).set(data)
  return ab
}

export class FastFileLoader {
  private buffer: ArrayBuffer
  private view: DataView
  private textDecoder: TextDecoder

  constructor(buffer: ArrayBuffer) {
    this.buffer = buffer
    this.view = new DataView(buffer)
    this.textDecoder = new TextDecoder('ascii')
  }

  private readString(offset: number, length: number): string {
    const bytes = new Uint8Array(this.buffer, offset, length)
    return this.textDecoder.decode(bytes)
  }

  private readHex(offset: number, length: number): string {
    const clamped = Math.min(length, Math.max(0, this.buffer.byteLength - offset))
    const bytes = new Uint8Array(this.buffer, offset, clamped)
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' ')
  }

  private detectMagic(raw: string): FastFileMagic {
    const trimmed = raw.replace(/[^\x20-\x7E]/g, '')
    for (const m of SUPPORTED_MAGICS) {
      if (m.startsWith(trimmed)) return m
    }
    throw new Error(
      `FastFile magic non reconnu. Reçu "${raw}". Supportés : ${SUPPORTED_MAGICS.join(', ')}`
    )
  }

  private readHeader(): FastFileHeader {
    if (this.buffer.byteLength < 12) {
      throw new Error(`FastFile trop petit : ${this.buffer.byteLength} bytes, minimum 12 requis`)
    }

    const magicRaw = this.readString(0, 8)
    const magic = this.detectMagic(magicRaw)
    const version = this.view.getUint32(8, true)

    const zoneOffset = magic === 'IWff0100' ? ZONE_OFFSET_SIGNED : ZONE_OFFSET_UNSIGNED

    console.log(`Header: magic="${magic}" version=${version} fileSize=${this.buffer.byteLength}`)
    console.log(`Hex debut: ${this.readHex(0, 32)}`)
    console.log(`Zone offset: ${zoneOffset} (0x${zoneOffset.toString(16)})`)

    return { magic, version }
  }

  load(): ArrayBuffer {
    console.log(`\nChargement: ${this.buffer.byteLength} bytes`)
    const header = this.readHeader()

    const zoneOffset = header.magic === 'IWff0100' ? ZONE_OFFSET_SIGNED : ZONE_OFFSET_UNSIGNED

    if (this.buffer.byteLength < zoneOffset) {
      throw new Error(
        `Fichier trop petit pour ${header.magic}: ${this.buffer.byteLength} bytes, ` +
        `besoin d'au moins ${zoneOffset}`
      )
    }

    const compressed = new Uint8Array(this.buffer, zoneOffset)
    console.log(`Donnees compressees: ${compressed.length} bytes`)
    console.log(`Hex debut compression: ${this.readHex(zoneOffset, 16)}`)

    try {
      const decompressed = pako.inflate(compressed)
      console.log(`✓ Decompression reussie: ${compressed.length} → ${decompressed.length} bytes`)
      return bytesToArrayBuffer(decompressed)
    } catch (e) {
      throw new Error(
        `Echec decompression ${header.magic} v${header.version}: ${e}`
      )
    }
  }
}
