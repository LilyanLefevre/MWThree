import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { ModelGeometry } from '@mwthree/iw5-core'
import type { MapWorld } from '../types'
import type { StaticModelData } from '../worker/protocol'
import { buildMaterials } from './materials'

const LOD_REFRESH = 0.25 // seconds between near/far reassignments
/** dev/testing: ?nolod draws every instance with LOD 0 */
const NO_LOD = import.meta.env.DEV && new URLSearchParams(location.search).has('nolod')

function makeGeometry(d: ModelGeometry): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(d.positions, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(d.normals, 3))
  g.setAttribute('uv', new THREE.BufferAttribute(d.uvs, 2))
  g.setIndex(new THREE.BufferAttribute(d.indices, 1))
  d.groups.forEach((grp, i) => g.addGroup(grp.start, grp.count, i))
  return g
}

function makeMesh(geometry: THREE.BufferGeometry, groups: ModelGeometry['groups'], mats: Map<string, THREE.Material>, count: number): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(geometry, groups.map(g => mats.get(g.material)!), count)
  m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3).fill(1), 3)
  m.frustumCulled = false // the bounding sphere is the model's, not the instances'
  return m
}

/**
 * One model: LOD 0 instanced mesh, plus a LOD 1 mesh for the instances farther than the model's switch
 * distance (instances are redistributed between the two a few times per second).
 */
function Batch({ data, mats }: { data: StaticModelData; mats: Map<string, THREE.Material> }) {
  const n = data.matrices.length / 16
  const meshes = useMemo(() => {
    const near = makeMesh(makeGeometry(data), data.groups, mats, n)
    const far = data.far ? makeMesh(makeGeometry(data.far), data.far.groups, mats, n) : null
    // until the first LOD pass, everything is drawn with LOD 0
    ;(near.instanceMatrix.array as Float32Array).set(data.matrices)
    if (data.instanceColors) (near.instanceColor!.array as Float32Array).set(data.instanceColors)
    if (far) far.count = 0
    return { near, far }
  }, [data, mats, n])
  useEffect(() => () => {
    for (const m of [meshes.near, meshes.far]) { if (m) { m.geometry.dispose(); m.dispose() } }
  }, [meshes])

  const timer = useRef(0)
  useFrame(({ camera }, dt) => {
    const { near, far } = meshes
    if (!far || !data.farDistance || NO_LOD) return
    timer.current -= dt
    if (timer.current > 0) return
    timer.current = LOD_REFRESH
    const d2 = data.farDistance * data.farDistance
    const m = data.matrices, c = data.instanceColors
    const nm = near.instanceMatrix.array as Float32Array, fm = far.instanceMatrix.array as Float32Array
    const nc = near.instanceColor!.array as Float32Array, fc = far.instanceColor!.array as Float32Array
    let ni = 0, fi = 0
    const { x, y, z } = camera.position
    for (let i = 0; i < n; i++) {
      const dx = m[i * 16 + 12] - x, dy = m[i * 16 + 13] - y, dz = m[i * 16 + 14] - z
      const isFar = dx * dx + dy * dy + dz * dz > d2
      const k = isFar ? fi++ : ni++
      ;(isFar ? fm : nm).set(m.subarray(i * 16, i * 16 + 16), k * 16)
      if (c) (isFar ? fc : nc).set(c.subarray(i * 3, i * 3 + 3), k * 3)
    }
    near.count = ni; far.count = fi
    near.instanceMatrix.needsUpdate = far.instanceMatrix.needsUpdate = true
    near.instanceColor!.needsUpdate = far.instanceColor!.needsUpdate = true
  })

  return (
    <>
      <primitive object={meshes.near} />
      {meshes.far && <primitive object={meshes.far} />}
    </>
  )
}

/** Static props (crates, vehicles, foliage…), instanced per model with two levels of detail. */
export function StaticModels({ world }: { world: MapWorld }) {
  const built = useMemo(() => {
    const names = new Set<string>()
    for (const m of world.staticModels) {
      for (const g of m.groups) names.add(g.material)
      for (const g of m.far?.groups ?? []) names.add(g.material)
    }
    return buildMaterials(world, names)
  }, [world.staticModels, world.materialImages, world.textures])
  useEffect(() => () => { built.map.forEach(m => m.dispose()); built.textures.forEach(t => t.dispose()) }, [built])
  return <>{world.staticModels.map((m, i) => <Batch key={`${m.name}-${i}`} data={m} mats={built.map} />)}</>
}
