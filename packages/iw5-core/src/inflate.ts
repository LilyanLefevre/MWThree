// Decompression with an output cap: a hostile archive (decompression bomb) fails instead of exhausting the memory.
import * as pako from 'pako'
import { Decompress as ZstdDecompress } from 'fzstd'

/** Ceiling for a whole decompressed FastFile (the biggest official maps stay far below). */
export const MAX_ZONE_BYTES = 1024 * 1024 * 1024
/** Ceiling for one archive entry or one embedded file (images, scripts). */
export const MAX_ENTRY_BYTES = 256 * 1024 * 1024

function join(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total)
  let o = 0
  for (const c of chunks) { out.set(c, o); o += c.length }
  return out
}

const tooBig = (max: number) => new Error(`decompressed data exceeds ${max >> 20} MiB`)

/** Reads a decompression stream, aborting as soon as it outputs more than `max` bytes. */
export async function drainCapped(stream: ReadableStream<Uint8Array>, max: number): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (let c = await reader.read(); !c.done; c = await reader.read()) {
    total += c.value.length
    if (total > max) { await reader.cancel().catch(() => {}); throw tooBig(max) }
    chunks.push(c.value)
  }
  return join(chunks, total)
}

/** pako (zlib or raw deflate), capped. */
export function inflateCapped(data: Uint8Array, max: number, raw = false): Uint8Array {
  const chunks: Uint8Array[] = []
  let total = 0
  const inf = new pako.Inflate({ raw })
  inf.onData = (c: Uint8Array) => {
    total += c.length
    if (total > max) throw tooBig(max)
    chunks.push(c)
  }
  inf.push(data, true)
  if (inf.err) throw new Error(inf.msg || `inflate error ${inf.err}`)
  return join(chunks, total)
}

/** Zstandard, capped. */
export function zstdCapped(data: Uint8Array, max: number): Uint8Array {
  const chunks: Uint8Array[] = []
  let total = 0
  const d = new ZstdDecompress(c => {
    total += c.length
    if (total > max) throw tooBig(max)
    chunks.push(c)
  })
  d.push(data, true)
  return join(chunks, total)
}
