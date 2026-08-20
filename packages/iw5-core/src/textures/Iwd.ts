// Minimal random-access ZIP reader for .iwd archives (deflate or stored entries).
import * as pako from 'pako'

export interface RandomAccess {
  size: number
  read(offset: number, length: number): Promise<Uint8Array>
}

export interface IwdEntry { name: string; method: number; compSize: number; size: number; offset: number }

export class IwdArchive {
  entries = new Map<string, IwdEntry>()
  constructor(private src: RandomAccess) {}

  /** Parse the central directory. */
  async open(): Promise<this> {
    const tailLen = Math.min(this.src.size, 66000)
    const tail = await this.src.read(this.src.size - tailLen, tailLen)
    const tdv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength)
    let eocd = -1
    for (let i = tail.length - 22; i >= 0; i--) if (tdv.getUint32(i, true) === 0x06054b50) { eocd = i; break }
    if (eocd < 0) throw new Error('not a zip file (no end of central directory)')
    const count = tdv.getUint16(eocd + 10, true)
    const cdSize = tdv.getUint32(eocd + 12, true)
    const cdOffset = tdv.getUint32(eocd + 16, true)
    const cd = await this.src.read(cdOffset, cdSize)
    const dv = new DataView(cd.buffer, cd.byteOffset, cd.byteLength)
    let p = 0
    for (let i = 0; i < count && p + 46 <= cd.length; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break
      const method = dv.getUint16(p + 10, true)
      const compSize = dv.getUint32(p + 20, true), size = dv.getUint32(p + 24, true)
      const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true)
      const offset = dv.getUint32(p + 42, true)
      let name = ''
      for (let k = 0; k < nl; k++) name += String.fromCharCode(cd[p + 46 + k])
      this.entries.set(name, { name, method, compSize, size, offset })
      p += 46 + nl + el + cl
    }
    return this
  }

  async read(name: string): Promise<Uint8Array | null> {
    const e = this.entries.get(name)
    if (!e) return null
    // one read for the local header and the data: the local name/extra fields are usually as long as
    // the central directory's, plus some slack; fall back to a second read when they are longer
    const guess = 30 + e.name.length + 64
    let chunk = await this.src.read(e.offset, Math.min(guess + e.compSize, this.src.size - e.offset))
    const ldv = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength)
    const skip = 30 + ldv.getUint16(26, true) + ldv.getUint16(28, true)
    if (skip + e.compSize > chunk.length) chunk = await this.src.read(e.offset, skip + e.compSize)
    const data = chunk.subarray(skip, skip + e.compSize)
    if (e.method === 0) return data
    if (e.method === 8) return pako.inflateRaw(data)
    throw new Error(`unsupported zip method ${e.method} for ${name}`)
  }
}

/** All the images of a set of .iwd archives, addressed by image name (without `images/` and `.iwi`). */
export class ImageLibrary {
  private index = new Map<string, IwdArchive>()
  async addArchive(src: RandomAccess): Promise<void> {
    const ar = await new IwdArchive(src).open()
    for (const name of ar.entries.keys()) {
      if (name.startsWith('images/') && name.endsWith('.iwi')) this.index.set(name.slice(7, -4), ar)
    }
  }
  has(name: string): boolean { return this.index.has(name) }
  get size(): number { return this.index.size }
  async readIwi(name: string): Promise<Uint8Array | null> {
    return (await this.index.get(name)?.read(`images/${name}.iwi`)) ?? null
  }
}
