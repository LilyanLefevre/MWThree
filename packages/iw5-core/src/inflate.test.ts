import { describe, expect, it } from 'vitest'
import * as pako from 'pako'
import { inflateCapped } from './inflate'

describe('inflateCapped', () => {
  const bomb = pako.deflate(new Uint8Array(10 * 1024 * 1024))
  it('inflates within the cap', () => expect(inflateCapped(bomb, 11 * 1024 * 1024).length).toBe(10 * 1024 * 1024))
  it('refuses a decompression bomb', () => expect(() => inflateCapped(bomb, 1024 * 1024)).toThrow(/exceeds/))
})
