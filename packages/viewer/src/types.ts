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

import type { SpawnPoint, MapStats, CollisionData } from './worker/protocol'

/** A loaded map, ready to render (meters, Y-up). */
export interface MapWorld {
  fileName: string
  positions: Float32Array
  normals: Float32Array
  colors: Float32Array
  indices: Uint32Array
  /** null when the zone has no clipMap: the visible mesh is used for physics */
  collision: CollisionData | null
  spawns: SpawnPoint[]
  stats: MapStats
}
