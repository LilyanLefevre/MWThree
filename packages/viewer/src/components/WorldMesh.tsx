import { useEffect, useMemo } from 'react'
import { RigidBody, TrimeshCollider } from '@react-three/rapier'
import * as THREE from 'three'
import type { MapWorld } from '../types'
import { buildWorldMaterials } from './materials'

export function WorldMesh({ world, showCollision }: { world: MapWorld; showCollision: boolean }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(world.positions, 3))
    g.setAttribute('normal', new THREE.BufferAttribute(world.normals, 3))
    g.setAttribute('uv', new THREE.BufferAttribute(world.uvs, 2))
    g.setAttribute('uv1', new THREE.BufferAttribute(world.lmUvs, 2))
    g.setIndex(new THREE.BufferAttribute(world.indices, 1))
    world.groups.forEach((grp, i) => g.addGroup(grp.start, grp.count, i))
    g.computeBoundingSphere()
    return g
  }, [world.positions, world.normals, world.uvs, world.lmUvs, world.indices, world.groups])
  useEffect(() => () => geometry.dispose(), [geometry])

  const materials = useMemo(() => {
    return buildWorldMaterials(world)
  }, [world.groups, world.materialImages, world.textures, world.lightmaps])
  useEffect(() => () => { materials.list.forEach(m => m.dispose()); materials.textures.forEach(t => t.dispose()) }, [materials])

  const collisionGeometry = useMemo(() => {
    if (!world.collision) return null
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(world.collision.positions, 3))
    g.setIndex(new THREE.BufferAttribute(world.collision.indices, 1))
    return g
  }, [world.collision])
  useEffect(() => () => collisionGeometry?.dispose(), [collisionGeometry])

  const phys = world.collision ?? { positions: world.positions, indices: world.indices }
  return (
    <>
      <mesh geometry={geometry} material={materials.list} visible={!showCollision} />
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
