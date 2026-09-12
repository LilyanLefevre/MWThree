import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, openSync, readSync, fstatSync } from 'node:fs'
import { join } from 'node:path'
import { ImageLibrary } from './Iwd.js'
import { parseIwi } from './Iwi.js'

const MAIN = join(__dirname, '..', '..', '..', '..', 'inputs', 'main')

describe.skipIf(!existsSync(MAIN))('wavelet IWi (inputs/main)', () => {
  it('decodes a wavelet RGB texture into a plausible image', async () => {
    const lib = new ImageLibrary()
    await lib.addArchives(readdirSync(MAIN).filter(n => n.endsWith('.iwd') && !n.startsWith('._')).sort().map(n => {
      const fd = openSync(join(MAIN, n), 'r')
      return { size: fstatSync(fd).size, read: async (o: number, l: number) => { const b = new Uint8Array(l); readSync(fd, b, 0, l, o); return b } }
    }))
    const img = parseIwi((await lib.readIwi('wood_split_log_brown_col'))!, 512)
    expect(img.format).toBe(7)
    expect([img.width, img.height]).toEqual([512, 512])
    // brown wood: opaque, red above blue on average, with real texture detail
    let r = 0, b = 0, min = 255, max = 0, translucent = 0
    for (let i = 0; i < img.rgba.length; i += 4) {
      r += img.rgba[i]; b += img.rgba[i + 2]
      if (img.rgba[i + 3] !== 255) translucent++
      min = Math.min(min, img.rgba[i + 1]); max = Math.max(max, img.rgba[i + 1])
    }
    expect(translucent).toBe(0)
    expect(r).toBeGreaterThan(b)
    expect(max - min).toBeGreaterThan(60)
  })
}, 60_000)
