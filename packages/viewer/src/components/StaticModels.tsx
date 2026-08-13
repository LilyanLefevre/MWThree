import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { MapWorld } from '../types'
import type { StaticModelData } from '../worker/protocol'
import { buildMaterials } from './materials'

function Batch({ data, mats }: { data: StaticModelData; mats: Map<string, THREE.Material> }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(data.positions, 3))
    g.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3))
    g.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2))
    g.setIndex(new THREE.BufferAttribute(data.indices, 1))
    data.groups.forEach((grp, i) => g.addGroup(grp.start, grp.count, i))
    return g
  }, [data])
  const mesh = useMemo(() => {
    const m = new THREE.InstancedMesh(geometry, data.groups.map(g => mats.get(g.material)!), data.matrices.length / 16)
    ;(m.instanceMatrix.array as Float32Array).set(data.matrices)
    m.instanceMatrix.needsUpdate = true
    m.frustumCulled = false // the bounding sphere is the model's, not the instances'
    return m
  }, [geometry, data, mats])
  useEffect(() => () => { geometry.dispose(); mesh.dispose() }, [geometry, mesh])
  return <primitive object={mesh} />
}

/** Static props (crates, vehicles, foliage…), one InstancedMesh per model. */
export function StaticModels({ world }: { world: MapWorld }) {
  const built = useMemo(() => {
    const names = new Set<string>()
    for (const m of world.staticModels) for (const g of m.groups) names.add(g.material)
    return buildMaterials(world, names)
  }, [world.staticModels, world.materialImages, world.textures])
  useEffect(() => () => { built.map.forEach(m => m.dispose()); built.textures.forEach(t => t.dispose()) }, [built])
  return <>{world.staticModels.map((m, i) => <Batch key={`${m.name}-${i}`} data={m} mats={built.map} />)}</>
}
