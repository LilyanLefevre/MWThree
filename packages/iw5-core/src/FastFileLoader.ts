import * as pako from 'pako'
import { decompress as zstdDecompress } from 'fzstd'

export const SUPPORTED_MAGICS = ['IWff0100', 'IWffu100'] as const
export type FastFileMagic = typeof SUPPORTED_MAGICS[number]

export interface FastFileHeader {
  magic: FastFileMagic
  version: number
}

const HEADER_SIZE = 12
const PREFIX_SIZE = 9
const AUTH_OFFSET = HEADER_SIZE + PREFIX_SIZE // 21
const AUTH_HEADER_SIZE = 0x4000 // 16384
const CHUNK_SIZE = 0x2000 // 8192
const DATA_CHUNKS_PER_GROUP = 256

/** Zstandard frame magic 0xFD2FB528 (little endian): custom-map linkers compress with zstd instead of zlib. */
const isZstd = (s: Uint8Array) => s.length > 4 && s[0] === 0x28 && s[1] === 0xb5 && s[2] === 0x2f && s[3] === 0xfd

function bytesToArrayBuffer(data: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(data.length)
  new Uint8Array(ab).set(data)
  return ab
}

export class FastFileLoader {
  private buffer: ArrayBuffer
  private textDecoder: TextDecoder

  constructor(buffer: ArrayBuffer) {
    this.buffer = buffer
    this.textDecoder = new TextDecoder('ascii')
  }

  private readString(offset: number, length: number): string {
    const bytes = new Uint8Array(this.buffer, offset, length)
    return this.textDecoder.decode(bytes)
  }

  private detectMagic(raw: string): FastFileMagic {
    for (const m of SUPPORTED_MAGICS) {
      if (raw.startsWith(m)) return m
    }
    throw new Error(
      `Unknown FastFile magic "${raw}". Supported: ${SUPPORTED_MAGICS.join(', ')}`
    )
  }

  private get magic(): FastFileMagic {
    return this.detectMagic(this.readString(0, 8))
  }

  load(): ArrayBuffer {
    const compressed = this.compressedStream()
    try {
      return bytesToArrayBuffer(isZstd(compressed) ? zstdDecompress(compressed) : pako.inflate(compressed))
    } catch (e) {
      throw new Error(`Decompression failed: ${e instanceof Error ? e.message : e}`)
    }
  }

  /** Same as load(), but uses the platform's native zlib (DecompressionStream) when available: much faster in browsers. */
  async loadAsync(): Promise<ArrayBuffer> {
    const compressed = this.compressedStream()
    if (typeof DecompressionStream !== 'undefined' && !isZstd(compressed)) {
      try {
        const stream = new Blob([compressed as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'))
        return await new Response(stream).arrayBuffer()
      } catch {
        // e.g. trailing bytes after the zlib stream: fall back to pako
      }
    }
    return this.load()
  }

  /** The concatenated zlib stream, with FastFile headers and signature chunks removed. */
  private compressedStream(): Uint8Array {
    if (this.buffer.byteLength < 12) {
      throw new Error(`FastFile too small: ${this.buffer.byteLength} bytes, need at least 12`)
    }
    return this.magic === 'IWff0100' ? this.signedStream() : this.unsignedStream()
  }

  private unsignedStream(): Uint8Array {
    if (this.buffer.byteLength < AUTH_OFFSET) {
      throw new Error(`Unsigned FF too small: ${this.buffer.byteLength} bytes, need at least ${AUTH_OFFSET}`)
    }
    return new Uint8Array(this.buffer, AUTH_OFFSET)
  }

  private signedStream(): Uint8Array {
    if (this.buffer.byteLength < AUTH_OFFSET + AUTH_HEADER_SIZE) {
      throw new Error(`Signed FF too small: ${this.buffer.byteLength} bytes, need at least ${AUTH_OFFSET + AUTH_HEADER_SIZE}`)
    }

    const data = new Uint8Array(this.buffer)
    const dataChunks: Uint8Array[] = []
    let offset = AUTH_OFFSET + AUTH_HEADER_SIZE // 16405

    while (offset < data.length) {
      for (let i = 0; i < DATA_CHUNKS_PER_GROUP && offset < data.length; i++) {
        const end = Math.min(offset + CHUNK_SIZE, data.length)
        dataChunks.push(data.subarray(offset, end))
        offset = end
      }
      offset += CHUNK_SIZE // skip the hash chunk that follows each group
    }

    if (dataChunks.length === 0) {
      throw new Error('No data chunks found in signed FF')
    }

    const concat = new Uint8Array(dataChunks.reduce((sum, c) => sum + c.length, 0))
    let pos = 0
    for (const c of dataChunks) {
      concat.set(c, pos)
      pos += c.length
    }
    return concat
  }
}
