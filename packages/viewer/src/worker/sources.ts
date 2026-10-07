import type { RandomAccess } from '@mwthree/iw5-core'
import type { IwdSource } from './protocol'

export async function openSource(src: IwdSource): Promise<RandomAccess> {
  if ('file' in src) {
    const f = src.file
    return { size: f.size, read: async (o, l) => new Uint8Array(await f.slice(o, o + l).arrayBuffer()) }
  }
  const head = await fetch(src.url, { method: 'HEAD' })
  const size = Number(head.headers.get('content-length'))
  return {
    size,
    read: async (o, l) => {
      const r = await fetch(src.url, { headers: { Range: `bytes=${o}-${o + l - 1}` } })
      return new Uint8Array(await r.arrayBuffer())
    },
  }
}
