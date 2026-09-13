// IndexedDB cache of decoded maps: a second load of the same .ff skips decompression, parsing and texture decoding.

/** Bump whenever the extracted data changes shape or content. */
export const CACHE_VERSION = 18

const DB = 'mwthree-cache'
const STORE = 'maps'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  try {
    const db = await open()
    return await new Promise<T | undefined>((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get(key)
      req.onsuccess = () => resolve(req.result as T | undefined)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return undefined
  }
}

/** Stores a structured clone of `value` (taken synchronously: the caller may transfer its buffers right after). */
export async function cachePut(key: string, value: unknown): Promise<void> {
  try {
    const db = await open()
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(value, key)
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error) })
  } catch {
    // quota exceeded or IndexedDB unavailable: the cache is only an optimisation
  }
}

/** Key of a FastFile: name, size and a sampled hash of its content. */
export function cacheKey(fileName: string, buffer: ArrayBuffer): string {
  const u8 = new Uint8Array(buffer)
  let h = 2166136261
  const step = Math.max(1, Math.floor(u8.length / 65536))
  for (let i = 0; i < u8.length; i += step) { h ^= u8[i]; h = Math.imul(h, 16777619) }
  return `v${CACHE_VERSION}:${fileName}:${u8.length}:${(h >>> 0).toString(16)}`
}

/** Every ArrayBuffer reachable from a message, for zero-copy transfer. */
export function transferablesOf(value: unknown, out = new Set<ArrayBuffer>()): ArrayBuffer[] {
  if (value instanceof ArrayBuffer) out.add(value)
  else if (ArrayBuffer.isView(value)) { if (value.buffer instanceof ArrayBuffer) out.add(value.buffer) }
  else if (Array.isArray(value)) for (const v of value) transferablesOf(v, out)
  else if (value && typeof value === 'object') for (const v of Object.values(value)) transferablesOf(v, out)
  return [...out]
}
