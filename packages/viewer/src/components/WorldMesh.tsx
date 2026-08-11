import { useEffect, useMemo } from 'react'
import { RigidBody, TrimeshCollider } from '@react-three/rapier'
import * as THREE from 'three'
import type { MapWorld } from '../types'

export function WorldMesh({ world, showCollision }: { world: MapWorld; showCollision: boolean }) {
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

  const collisionGeometry = useMemo(() => {
    if (!world.collision) return null
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(world.collision.positions, 3))
    g.setIndex(new THREE.BufferAttribute(world.collision.indices, 1))
    return g
  }, [world])
  useEffect(() => () => collisionGeometry?.dispose(), [collisionGeometry])

  const phys = world.collision ?? { positions: world.positions, indices: world.indices }
  return (
    <>
      <mesh geometry={geometry} visible={!showCollision}>
        <meshLambertMaterial vertexColors />
      </mesh>
      {showCollision && collisionGeometry && (
        <mesh geometry={collisionGeometry}>
          <meshBasicMaterial color="#ff5a36" wireframe />
        </mesh>
      )}
      <RigidBody type="fixed" colliders={false}>
        <TrimeshCollider args={[phys.positions, phys.indices]} />
      </RigidBody>
    </>
  )
}
