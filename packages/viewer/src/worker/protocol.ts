import type { StaticModelBatch, MaterialGroup, Lightmap, Sun, Objective } from '@mwthree/iw5-core'

/** Where to read the .iwd archives from: local files (folder picker) or URLs (dev server, HTTP Range). */
export type IwdSource = { file: File } | { url: string }

/** `s3tc`: the GPU accepts S3TC (DXT) textures, so images can be uploaded without being decoded. */
export interface MapRequest { buffer: ArrayBuffer; fileName: string; iwd: IwdSource[]; s3tc: boolean }

export interface TextureData {
  name: string
  width: number
  height: number
  hasAlpha: boolean
  normal?: boolean
  /** decoded pixels (normal maps, non-S3TC formats or GPUs without S3TC) */
  rgba?: Uint8Array
  /** S3TC mip chain, uploaded as is */
  compressed?: { kind: 'dxt1' | 'dxt3' | 'dxt5'; mips: { width: number; height: number; data: Uint8Array }[] }
}

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
  /** props placed by entities (vehicles, crates…) and distinct entity models absent from the zone */
  entityProps: number
  missingEntityModels: number
  msDecompress: number
  msParse: number
  msTotal: number
  /** time spent on textures (0 until they arrive) */
  msTextures?: number
  /** loaded from the IndexedDB cache */
  fromCache: boolean
}

/** Physics geometry built from clipMap_t brushes and terrain triangles. */
export interface CollisionData { positions: Float32Array; indices: Uint32Array; brushes: number; models: number }

export type StaticModelData = Pick<StaticModelBatch, 'name' | 'positions' | 'normals' | 'uvs' | 'colors' | 'indices' | 'groups' | 'matrices' | 'far' | 'farDistance'> & {
  /** RGB light multiplier per instance, sampled from the world lightmap under it */
  instanceColors: Float32Array
}

export type MapResponse =
  | { type: 'progress'; stage: string }
  | { type: 'textures'; textures: TextureData[]; materialImages: Record<string, string | null>; materialNormals: Record<string, string | null>; missing: number
      /** equirectangular sky (scene axes), from the map's sky cube map */
      sky: { width: number; height: number; rgba: Uint8Array } | null
      /** time spent reading and decoding the images */
      ms: number }
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
      sun: Sun | null
      objectives: Objective[]
      spawns: SpawnPoint[]
      stats: MapStats
    }
