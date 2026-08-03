export const POINTER_FOLLOWING = 0xFFFFFFFF
export const POINTER_INSERT = 0xFFFFFFFE

export class ZoneStream {
  private view: DataView
  private offset: number

  constructor(private buffer: ArrayBuffer) {
    this.view = new DataView(buffer)
    this.offset = 0
  }

  tell(): number { return this.offset }
  seek(pos: number): void { this.offset = pos }
  skip(n: number): void { this.offset += n }
  remaining(): number { return this.buffer.byteLength - this.offset }

  u8(): number {
    const v = this.view.getUint8(this.offset)
    this.offset += 1
    return v
  }

  u16(): number {
    const v = this.view.getUint16(this.offset, true)
    this.offset += 2
    return v
  }

  u32(): number {
    const v = this.view.getUint32(this.offset, true)
    this.offset += 4
    return v
  }

  i32(): number {
    const v = this.view.getInt32(this.offset, true)
    this.offset += 4
    return v
  }

  f32(): number {
    const v = this.view.getFloat32(this.offset, true)
    this.offset += 4
    return v
  }

  bytes(length: number): Uint8Array {
    const v = new Uint8Array(this.buffer, this.offset, length)
    this.offset += length
    return v
  }

  cstring(): string {
    const start = this.offset
    while (this.offset < this.buffer.byteLength && this.view.getUint8(this.offset) !== 0) {
      this.offset++
    }
    const str = new TextDecoder('ascii').decode(new Uint8Array(this.buffer, start, this.offset - start))
    if (this.offset < this.buffer.byteLength) this.offset++
    return str
  }

  isFollowing(ptr: number): boolean {
    return ptr === POINTER_FOLLOWING
  }

  isInsert(ptr: number): boolean {
    return ptr === POINTER_INSERT
  }

  isNull(ptr: number): boolean {
    return ptr === 0
  }

  isOffset(ptr: number): boolean {
    return ptr > 0 && ptr < 0xFFFFFFFE
  }

  allocInBlock(align: number, size: number): number {
    const aligned = (this.offset + align - 1) & ~(align - 1)
    if (aligned !== this.offset) {
      this.offset = aligned
    }
    return this.offset - size
  }

  readXString(atStreamStart: boolean): string | null {
    if (atStreamStart) {
      const ptr = this.u32()
      if (this.isNull(ptr)) return null
      if (this.isFollowing(ptr)) {
        return this.cstring()
      }
      if (this.isOffset(ptr)) {
        return null
      }
      return null
    }
    return null
  }

  readXStringArray(atStreamStart: boolean, count: number): (string | null)[] {
    const ptrs: number[] = []
    if (atStreamStart) {
      for (let i = 0; i < count; i++) {
        ptrs.push(this.u32())
      }
    }
    const result: (string | null)[] = []
    for (let i = 0; i < count; i++) {
      const ptr = atStreamStart ? ptrs[i] : 0
      if (this.isNull(ptr)) {
        result.push(null)
      } else if (this.isFollowing(ptr)) {
        result.push(this.cstring())
      } else {
        result.push(null)
      }
    }
    return result
  }

  readAssetList(): { stringCount: number; assetCount: number; strings: (string | null)[]; assets: { type: number; ptr: number }[] } {
    const stringCount = this.u32()
    const stringsPtr = this.u32()
    const assetCount = this.u32()
    const assetsPtr = this.u32()

    let strings: (string | null)[] = []
    if (this.isFollowing(stringsPtr)) {
      strings = this.readXStringArray(true, stringCount)
    }

    let assets: { type: number; ptr: number }[] = []
    if (this.isFollowing(assetsPtr)) {
      for (let i = 0; i < assetCount; i++) {
        const type = this.u32()
        const ptr = this.u32()
        assets.push({ type, ptr })
      }
    }

    return { stringCount, assetCount, strings, assets }
  }
}
