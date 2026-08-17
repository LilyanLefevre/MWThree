import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { PointerLockControls } from '@react-three/drei'
import { CapsuleCollider, RigidBody, useRapier } from '@react-three/rapier'
import type { RapierRigidBody } from '@react-three/rapier'
import * as THREE from 'three'
import { playerState } from '../playerState'

const RADIUS = 0.35
const HALF = 0.45 // capsule half-height (cylinder part)
const EYE = 0.7 // eye above capsule center
const RUN = 4.8
const FLY = 14
const JUMP = 6.5

const keys: Record<string, boolean> = {}
/** dev/testing: accept keyboard input without pointer lock (?free) */
const FREE_INPUT = import.meta.env.DEV && new URLSearchParams(location.search).has('free')

export interface PlayerProps {
  /** meters, Y-up */
  spawn: [number, number, number]
  /** radians around Y */
  yaw: number
  onFly?: (fly: boolean) => void
}

export function Player({ spawn, yaw, onFly }: PlayerProps) {
  const { camera } = useThree()
  const { world, rapier } = useRapier()
  const body = useRef<RapierRigidBody>(null)
  const controls = useRef<{ isLocked: boolean } | null>(null)
  const fly = useRef(false)
  const dir = useRef(new THREE.Vector3())

  useEffect(() => {
    camera.position.set(spawn[0], spawn[1] + EYE, spawn[2])
    camera.rotation.set(0, yaw, 0, 'YXZ')
    body.current?.setTranslation({ x: spawn[0], y: spawn[1], z: spawn[2] }, true)
    body.current?.setLinvel({ x: 0, y: 0, z: 0 }, true)
  }, [camera, spawn, yaw])

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      keys[e.code] = true
      if (e.code === 'KeyV' && !e.repeat) {
        fly.current = !fly.current
        const b = body.current
        if (b) {
          if (fly.current) b.setEnabled(false)
          else {
            const p = camera.position
            b.setEnabled(true)
            b.setTranslation({ x: p.x, y: p.y - EYE, z: p.z }, true)
            b.setLinvel({ x: 0, y: 0, z: 0 }, true)
          }
        }
        onFly?.(fly.current)
      }
    }
    const up = (e: KeyboardEvent) => { keys[e.code] = false }
    document.addEventListener('keydown', down)
    document.addEventListener('keyup', up)
    return () => { document.removeEventListener('keydown', down); document.removeEventListener('keyup', up) }
  }, [camera, onFly])

  useFrame((_, dt) => {
    const b = body.current
    if (!b) return
    if (!fly.current) {
      const t0 = b.translation()
      camera.position.set(t0.x, t0.y + EYE, t0.z)
    }
    playerState.x = camera.position.x; playerState.y = camera.position.y; playerState.z = camera.position.z
    playerState.yaw = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ').y
    if (import.meta.env.DEV) (window as unknown as { __player?: unknown }).__player = { body: b.translation(), cam: camera.position.toArray(), fly: fly.current }
    if (!controls.current?.isLocked && !FREE_INPUT) return
    const d = Math.min(dt, 0.05)
    const wish = dir.current.set(0, 0, 0)
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion)
    if (!fly.current) { forward.y = 0; right.y = 0; forward.normalize(); right.normalize() }
    if (keys.KeyW || keys.KeyZ) wish.add(forward)
    if (keys.KeyS) wish.sub(forward)
    if (keys.KeyA || keys.KeyQ) wish.sub(right)
    if (keys.KeyD) wish.add(right)
    if (wish.lengthSq() > 0) wish.normalize()

    if (fly.current) {
      const boost = keys.ShiftLeft ? 3 : 1
      if (keys.Space) wish.y += 1
      if (keys.ControlLeft) wish.y -= 1
      camera.position.addScaledVector(wish, FLY * boost * d)
      return
    }

    const lin = b.linvel()
    const t = b.translation()
    // ground check: ray down from the capsule center
    const ray = new rapier.Ray({ x: t.x, y: t.y, z: t.z }, { x: 0, y: -1, z: 0 })
    const hit = world.castRay(ray, HALF + RADIUS + 0.12, true, undefined, undefined, undefined, b)
    const grounded = !!hit
    const speed = RUN * (keys.ShiftLeft ? 1.5 : 1)
    let vy = lin.y
    if (grounded && keys.Space && lin.y <= 0.5) vy = JUMP
    b.setLinvel({ x: wish.x * speed, y: vy, z: wish.z * speed }, true)
  })

  return (
    <>
      <RigidBody
        ref={body}
        type="dynamic"
        colliders={false}
        position={spawn}
        enabledRotations={[false, false, false]}
        linearDamping={0}
        ccd
      >
        <CapsuleCollider args={[HALF, RADIUS]} friction={0} />
      </RigidBody>
      <PointerLockControls ref={controls as never} />
    </>
  )
}
