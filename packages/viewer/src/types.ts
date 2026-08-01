export interface MapInfo {
  maps: string[]
  archives: string[]
  path: string
}

export interface ZoneAssetSummary {
  type: number
  typeName: string
  count: number
}

export interface ZoneBlockSummary {
  name: string
  size: number
}

export interface LoadResult {
  fileName: string
  compressedBytes: number
  decompressedBytes: number
  success: boolean
  error?: string
  zoneName?: string
  xfileSize?: number
  blocks?: ZoneBlockSummary[]
  assetCount?: number
  stringCount?: number
  assets?: ZoneAssetSummary[]
}
