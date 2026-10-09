// Menu images (map previews, loading screens) read from the .iwd archives and returned as PNG blobs.
import { ImageLibrary, parseIwi } from '@mwthree/iw5-core'
import { openSource } from './sources'
import type { IwdSource } from './protocol'

export type ImageRequest = { type: 'open'; iwd: IwdSource[] } | { type: 'image'; id: number; name: string; maxSize: number }
export type ImageResponse = { id: number; blob: Blob | null }

let lib: Promise<ImageLibrary> | null = null

self.onmessage = async (e: MessageEvent<ImageRequest>) => {
  const m = e.data
  if (m.type === 'open') {
    lib = (async () => { const l = new ImageLibrary(); await l.addArchives(await Promise.all(m.iwd.map(openSource))); return l })()
    return
  }
  let blob: Blob | null = null
  try {
    const data = await (await lib)?.readIwi(m.name)
    if (data) {
      const img = parseIwi(data, m.maxSize)
      const canvas = new OffscreenCanvas(img.width, img.height)
      canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.rgba), img.width, img.height), 0, 0)
      blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 })
    }
  } catch (err) { console.warn(`image ${m.name}:`, err) } // the caller shows a plain background
  ;(self as unknown as Worker).postMessage({ id: m.id, blob } satisfies ImageResponse)
}
