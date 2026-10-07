import { useEffect, useMemo } from 'react'
import { RigidBody, TrimeshCollider } from '@react-three/rapier'
import * as THREE from 'three'
import type { MapWorld } from '../types'

export function WorldMesh({ world }: { world: MapWorld }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(world.positions, 3))
    g.setAttribute('normal', new THREE.BufferAttribute(world.normals, 3))
    g.setAttribute('color', new THREE.BufferAttribute(world.colors, 3))
    g.setIndex(new THREE.BufferAttribute(world.indices, 1))
    g.computeBoundingSphere()
    return g
  }, [world])
  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <>
      <mesh geometry={geometry}>
        <meshLambertMaterial vertexColors />
      </mesh>
      <RigidBody type="fixed" colliders={false}>
        <TrimeshCollider args={[world.positions, world.indices]} />
      </RigidBody>
    </>
  )
}
