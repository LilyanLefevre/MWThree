import type { StaticModelBatch, MaterialGroup, Lightmap } from '@mwthree/iw5-core'

/** Where to read the .iwd archives from: local files (folder picker) or URLs (dev server, HTTP Range). */
export type IwdSource = { file: File } | { url: string }

export interface MapRequest { buffer: ArrayBuffer; fileName: string; iwd: IwdSource[] }

export interface TextureData { name: string; width: number; height: number; rgba: Uint8Array; hasAlpha: boolean }

export interface SpawnPoint {
  classname: string
  /** game units, Z-up */
  origin: [number, number, number]
  angles: [number, number, number]
}

export interface MapStats {
  zoneBytes: number
  assets: number
  assetCounts: Record<string, number>
  entities: number
  surfaces: number
  staticModels: number
  staticInstances: number
  textures: number
  msDecompress: number
  msParse: number
  msTotal: number
}

/** Physics geometry built from clipMap_t brushes and terrain triangles. */
export interface CollisionData { positions: Float32Array; indices: Uint32Array; brushes: number }

export type StaticModelData = Pick<StaticModelBatch, 'name' | 'positions' | 'normals' | 'uvs' | 'colors' | 'indices' | 'groups' | 'matrices'>

export type MapResponse =
  | { type: 'progress'; stage: string }
  | { type: 'textures'; textures: TextureData[]; materialImages: Record<string, string | null>; missing: number }
  | { type: 'error'; message: string }
  | {
      type: 'done'
      fileName: string
      positions: Float32Array
      normals: Float32Array
      uvs: Float32Array
      lmUvs: Float32Array
      vertexColors: Float32Array
      lightmaps: Lightmap[]
      colors: Float32Array
      indices: Uint32Array
      groups: MaterialGroup[]
      collision: CollisionData | null
      staticModels: StaticModelData[]
      spawns: SpawnPoint[]
      stats: MapStats
    }
