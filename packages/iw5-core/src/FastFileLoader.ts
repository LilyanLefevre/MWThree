import * as pako from 'pako'

export const SUPPORTED_MAGICS = ['IWff0100', 'IW4x'] as const
export type FastFileMagic = typeof SUPPORTED_MAGICS[number]

export interface FastFileHeader {
  magic: FastFileMagic
  version: number
}

const HEADER_CONFIG: Record<FastFileMagic, { magicLen: number; headerSize: number }> = {
  'IWff0100': { magicLen: 8, headerSize: 12 },
  'IW4x': { magicLen: 4, headerSize: 8 },
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
      throw new Error(
        `FastFile trop petit : ${this.buffer.byteLength} bytes, minimum 12 requis`
      )
    }

    // D'abord déterminer le format via la détection du magic
    const magicRaw = this.readString(0, 8)
    const magic = this.detectMagic(magicRaw)
    const cfg = HEADER_CONFIG[magic]
    const version = this.view.getUint32(cfg.magicLen, true)

    // Vérification version pour IW4x (version doit être 3) et IWff0100 (version doit être 1)
    if (magic === 'IWff0100' && version !== 1) {
      throw new Error(
        `Version FastFile non supportée pour ${magic}. Attendu 1, reçu ${version}`
      )
    }
    if (magic === 'IW4x' && version !== 3) {
      throw new Error(
        `Version FastFile non supportée pour ${magic}. Attendu 3, reçu ${version}`
      )
    }

    return { magic, version }
  }

  private getHeaderSize(): number {
    const magicRaw = this.readString(0, 4)
    for (const [m, cfg] of Object.entries(HEADER_CONFIG)) {
      if (m.startsWith(magicRaw) || magicRaw.startsWith(m)) {
        return cfg.headerSize
      }
    }
    return 12 // fallback
  }

  private decompressZlibBlocks(): ArrayBuffer {
    const chunks: Uint8Array[] = []
    let offset = this.getHeaderSize()

    while (offset < this.buffer.byteLength) {
      if (offset + 2 > this.buffer.byteLength) {
        console.warn(
          'FastFileLoader: fin du buffer atteinte pendant la lecture de la taille du bloc zlib.'
        )
        break
      }

      const blockSize = this.view.getUint16(offset, true)
      offset += 2

      if (blockSize === 0) {
        break
      }

      if (offset + blockSize > this.buffer.byteLength) {
        throw new Error(
          `Bloc zlib hors limites : attendu ${blockSize} bytes, seulement ${this.buffer.byteLength - offset} disponibles.`
        )
      }

      const compressed = new Uint8Array(this.buffer, offset, blockSize)
      offset += blockSize

      try {
        const decompressed = pako.inflate(compressed)
        chunks.push(decompressed)
      } catch (err: any) {
        throw new Error(
          `Échec décompression zlib à l'offset ${offset - blockSize} : ${err.message}`
        )
      }
    }

    const total = chunks.reduce((acc, c) => acc + c.length, 0)
    const result = new Uint8Array(total)
    let writeOffset = 0
    for (const chunk of chunks) {
      result.set(chunk, writeOffset)
      writeOffset += chunk.length
    }

    return result.buffer
  }

  load(): ArrayBuffer {
    console.log('Chargement FastFile...')
    const header = this.readHeader()
    console.log(`FastFile : ${header.magic}, version ${header.version}`)
    const zone = this.decompressZlibBlocks()
    console.log(
      `FastFile décompressé : ${this.buffer.byteLength} bytes → ${zone.byteLength} bytes`
    )
    return zone
  }
}
