import { useEffect, useRef } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import { PointerLockControls } from '@react-three/drei'
import { RigidBody } from '@react-three/rapier'
import * as THREE from 'three'

const SPEED = 5
const keys = { forward: false, backward: false, left: false, right: false, jump: false }

export function FPSCamera() {
  const { camera } = useThree()
  const controlsRef = useRef<any>(null)
  const direction = useRef(new THREE.Vector3())

  useEffect(() => {
    const onKey = (e: KeyboardEvent, down: boolean) => {
      switch (e.code) {
        case 'KeyW': keys.forward = down; break
        case 'KeyS': keys.backward = down; break
        case 'KeyA': keys.left = down; break
        case 'KeyD': keys.right = down; break
        case 'Space': keys.jump = down; break
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => onKey(e, true)
    const handleKeyUp = (e: KeyboardEvent) => onKey(e, false)

    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('keyup', handleKeyUp)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('keyup', handleKeyUp)
    }
  }, [])

  useFrame((_, delta) => {
    if (!controlsRef.current?.isLocked) return

    const dir = direction.current.set(0, 0, 0)
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion)

    if (keys.forward) dir.add(forward)
    if (keys.backward) dir.sub(forward)
    if (keys.left) dir.sub(right)
    if (keys.right) dir.add(right)

    if (dir.lengthSq() > 0) {
      dir.normalize().multiplyScalar(SPEED * delta)
      camera.position.add(dir)
    }
  })

  return (
    <group>
      <RigidBody
        ref={useRef(null)}
        type="dynamic"
        position={[0, 1, 0]}
        enabledRotations={[false, false, false]}
        lockRotations
      >
        <mesh visible={false}>
          <capsuleGeometry args={[0.3, 0.8]} />
        </mesh>
      </RigidBody>
      <PointerLockControls ref={controlsRef} />
    </group>
  )
}
