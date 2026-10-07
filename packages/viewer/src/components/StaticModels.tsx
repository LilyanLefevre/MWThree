import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { StaticModelData } from '../worker/protocol'

function Batch({ data }: { data: StaticModelData }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(data.positions, 3))
    g.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3))
    g.setAttribute('color', new THREE.BufferAttribute(data.colors, 3))
    g.setIndex(new THREE.BufferAttribute(data.indices, 1))
    return g
  }, [data])
  const mesh = useMemo(() => {
    const m = new THREE.InstancedMesh(geometry, undefined, data.matrices.length / 16)
    ;(m.instanceMatrix.array as Float32Array).set(data.matrices)
    m.instanceMatrix.needsUpdate = true
    m.frustumCulled = false // the bounding sphere is the model's, not the instances'
    return m
  }, [geometry, data])
  useEffect(() => () => { geometry.dispose(); mesh.dispose() }, [geometry, mesh])
  return (
    <primitive object={mesh}>
      <meshLambertMaterial vertexColors attach="material" />
    </primitive>
  )
}

/** Static props (crates, vehicles, foliage…), one InstancedMesh per model. */
export function StaticModels({ models }: { models: StaticModelData[] }) {
  return <>{models.map((m, i) => <Batch key={`${m.name}-${i}`} data={m} />)}</>
}
