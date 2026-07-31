export interface MapInfo {
  maps: string[]
  archives: string[]
  path: string
}

export interface LoadResult {
  fileName: string
  compressedBytes: number
  decompressedBytes: number
  success: boolean
  error?: string
}
