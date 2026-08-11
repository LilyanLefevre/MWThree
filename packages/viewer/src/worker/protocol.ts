export interface MapRequest { buffer: ArrayBuffer; fileName: string }

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
  msDecompress: number
  msParse: number
  msTotal: number
}

/** Physics geometry built from clipMap_t brushes and terrain triangles. */
export interface CollisionData { positions: Float32Array; indices: Uint32Array; brushes: number }

export type MapResponse =
  | { type: 'progress'; stage: string }
  | { type: 'error'; message: string }
  | {
      type: 'done'
      fileName: string
      positions: Float32Array
      normals: Float32Array
      colors: Float32Array
      indices: Uint32Array
      collision: CollisionData | null
      spawns: SpawnPoint[]
      stats: MapStats
    }
