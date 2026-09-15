import { useEffect, useState } from 'react'
import type { IwdSource } from './worker/protocol'
import type { ImageRequest, ImageResponse } from './worker/imageWorker'

/** Images of one set of .iwd archives (server or local folder), as object URLs; null when the image is missing. */
export interface ImageSource { get(name: string, maxSize?: number): Promise<string | null> }

export function createImageSource(iwd: IwdSource[]): ImageSource {
  const worker = new Worker(new URL('./worker/imageWorker.ts', import.meta.url), { type: 'module' })
  worker.postMessage({ type: 'open', iwd } satisfies ImageRequest)
  const pending = new Map<number, (blob: Blob | null) => void>()
  const urls = new Map<string, Promise<string | null>>()
  let next = 0
  worker.onmessage = (e: MessageEvent<ImageResponse>) => { pending.get(e.data.id)?.(e.data.blob); pending.delete(e.data.id) }
  return {
    get(name, maxSize = 2048) {
      const key = `${name}@${maxSize}`
      let url = urls.get(key)
      if (!url) {
        const id = next++
        url = new Promise<Blob | null>(resolve => {
          pending.set(id, resolve)
          worker.postMessage({ type: 'image', id, name, maxSize } satisfies ImageRequest)
        }).then(b => (b ? URL.createObjectURL(b) : null))
        urls.set(key, url)
      }
      return url
    },
  }
}

/** Object URL of an image of `source` (null while loading or when missing). */
export function useImage(source: ImageSource | null, ...names: string[]): string | null {
  const [url, setUrl] = useState<string | null>(null)
  const key = names.join('|')
  useEffect(() => {
    let alive = true
    setUrl(null)
    if (!source || !key) return
    ;(async () => {
      for (const n of key.split('|')) {
        const u = await source.get(n)
        if (u) { if (alive) setUrl(u); return }
      }
    })()
    return () => { alive = false }
  }, [source, key])
  return url
}
