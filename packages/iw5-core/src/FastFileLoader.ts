import * as pako from 'pako'

export const SUPPORTED_MAGICS = ['IWff0100', 'IW4x'] as const
export type FastFileMagic = typeof SUPPORTED_MAGICS[number]

export interface FastFileHeader {
  magic: FastFileMagic
  version: number
  headerSize: number
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
      `FastFile magic non reconnu. Reçu "${raw}" (nettoyé: "${trimmed}"). Supportés : ${SUPPORTED_MAGICS.join(', ')}`
    )
  }

  private readHeader(): FastFileHeader {
    if (this.buffer.byteLength < 12) {
      throw new Error(`FastFile trop petit : ${this.buffer.byteLength} bytes, minimum 12 requis`)
    }

    const magicRaw = this.readString(0, 8)
    const magic = this.detectMagic(magicRaw)
    const version = this.view.getUint32(8, true)

    // Taille de l'en-tête : après le magic + version, les blocs commencent
    // IW4x : 4 bytes magic + 4 bytes version = 8
    // IWff0100 : 8 bytes magic + 4 bytes version = 12
    const headerSize = magic === 'IW4x' ? 8 : 12

    console.log(`Header: magic="${magic}" version=${version} headerSize=${headerSize}`)
    console.log(`Hex dump debut: ${this.readHex(0, 48)}`)

    return { magic, version, headerSize }
  }

  private tryDecompress(strategy: string, offset: number): { data: Uint8Array | null; nextOffset: number } {
    if (offset >= this.buffer.byteLength) return { data: null, nextOffset: offset }
    const remaining = this.buffer.byteLength - offset
    const bytes = new Uint8Array(this.buffer, offset, remaining)

    if (strategy === 'raw_zlib') {
      // Tout le reste est un seul flux zlib
      try {
        const data = pako.inflate(bytes)
        console.log(`  raw_zlib OK: ${remaining} bytes → ${data.length} bytes`)
        return { data, nextOffset: this.buffer.byteLength }
      } catch { return { data: null, nextOffset: offset } }
    }

    if (strategy === 'uint16_blocks') {
      // Blocs avec taille uint16
      const chunks: Uint8Array[] = []
      let pos = offset
      while (pos < this.buffer.byteLength) {
        if (pos + 2 > this.buffer.byteLength) break
        const size = this.view.getUint16(pos, true)
        if (size === 0) break
        pos += 2
        if (pos + size > this.buffer.byteLength) break
        try {
          chunks.push(pako.inflate(new Uint8Array(this.buffer, pos, size)))
        } catch { return { data: null, nextOffset: offset } }
        pos += size
      }
      if (chunks.length === 0) return { data: null, nextOffset: offset }
      const total = chunks.reduce((a, c) => a + c.length, 0)
      const merged = new Uint8Array(total)
      let off = 0
      for (const c of chunks) { merged.set(c, off); off += c.length }
      console.log(`  uint16_blocks OK: ${chunks.length} blocs → ${total} bytes`)
      return { data: merged, nextOffset: pos }
    }

    if (strategy === 'uint32_blocks') {
      // Blocs avec taille uint32
      const chunks: Uint8Array[] = []
      let pos = offset
      while (pos < this.buffer.byteLength) {
        if (pos + 4 > this.buffer.byteLength) break
        const size = this.view.getUint32(pos, true)
        if (size === 0) break
        pos += 4
        if (pos + size > this.buffer.byteLength) break
        try {
          chunks.push(pako.inflate(new Uint8Array(this.buffer, pos, size)))
        } catch { return { data: null, nextOffset: offset } }
        pos += size
      }
      if (chunks.length === 0) return { data: null, nextOffset: offset }
      const total = chunks.reduce((a, c) => a + c.length, 0)
      const merged = new Uint8Array(total)
      let off = 0
      for (const c of chunks) { merged.set(c, off); off += c.length }
      console.log(`  uint32_blocks OK: ${chunks.length} blocs → ${total} bytes`)
      return { data: merged, nextOffset: pos }
    }

    return { data: null, nextOffset: offset }
  }

  load(): ArrayBuffer {
    console.log(`Chargement FastFile: ${this.buffer.byteLength} bytes`)
    const header = this.readHeader()

    // Essaye plusieurs stratégies de décompression
    const strategies = ['raw_zlib', 'uint16_blocks', 'uint32_blocks']
    for (const s of strategies) {
      console.log(`Essai stratégie: ${s} (offset=${header.headerSize})`)
      const result = this.tryDecompress(s, header.headerSize)
      if (result.data) {
        console.log(`✓ Succès: ${s} → ${result.data.length} bytes`)
        const ab = new ArrayBuffer(result.data.length)
        new Uint8Array(ab).set(result.data)
        return ab
      }
    }

    // Si rien n'a marché, affiche un dump hexa pour debug
    const remaining = this.buffer.byteLength - header.headerSize
    const dumpSize = Math.min(64, Math.max(remaining, 16))
    console.log(`Hex dump après header: ${this.readHex(header.headerSize, dumpSize)}`)

    throw new Error(
      `Impossible de décompresser le FastFile (magic=${header.magic}, version=${header.version}). ` +
      `Taille: ${this.buffer.byteLength} bytes, header: ${header.headerSize} bytes.`
    )
  }
}
