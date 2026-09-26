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
const CROUCH_EYE = 0.05 // eye above capsule center when crouched (Ctrl)
const CROUCH_SPEED = 0.45
const RUN = 4.8
const FLY = 14
const JUMP = 6.5
const GRAVITY = 20
/** the game's step height (18 units): low ledges, bars, curbs and rubble are walked over, not blocked by */
const STEP = 0.46

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
  const { world } = useRapier()
  const body = useRef<RapierRigidBody>(null)
  const controls = useRef<{ isLocked: boolean } | null>(null)
  const fly = useRef(false)
  const dir = useRef(new THREE.Vector3())
  const eye = useRef(EYE)
  /** capsule center, meters: the body is kinematic, moved by the character controller */
  const pos = useRef(new THREE.Vector3(...spawn))
  const vy = useRef(0)
  const grounded = useRef(false)
  // the type comes from @react-three/rapier's own copy of Rapier (a second copy sits at the root)
  const controller = useRef<ReturnType<typeof world.createCharacterController> | null>(null)
  // created and removed in the same effect: React's dev double mount would otherwise leave a removed controller behind
  useEffect(() => {
    const c = world.createCharacterController(0.01)
    c.enableAutostep(STEP, 0.1, false)
    c.enableSnapToGround(0.3)
    c.setMaxSlopeClimbAngle((50 * Math.PI) / 180)
    c.setMinSlopeSlideAngle((55 * Math.PI) / 180)
    c.setSlideEnabled(true)
    controller.current = c
    return () => { world.removeCharacterController(c); controller.current = null }
  }, [world])

  useEffect(() => {
    camera.position.set(spawn[0], spawn[1] + EYE, spawn[2])
    camera.rotation.set(0, yaw, 0, 'YXZ')
    pos.current.set(...spawn); vy.current = 0
    body.current?.setTranslation({ x: spawn[0], y: spawn[1], z: spawn[2] }, true)
  }, [camera, spawn, yaw])

  // dev/testing: aim the camera without the mouse (radians, yaw around Y, pitch up); `pos` (scene meters) moves it in fly mode
  useEffect(() => {
    if (!import.meta.env.DEV) return
    (window as unknown as { __look?: unknown }).__look = (y: number, pitch = 0, pos?: [number, number, number]) => {
      camera.rotation.set(pitch, y, 0, 'YXZ')
      if (pos && fly.current) camera.position.set(...pos)
    }
  }, [camera])

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
            pos.current.set(p.x, p.y - EYE, p.z); vy.current = 0
            b.setTranslation({ x: p.x, y: p.y - EYE, z: p.z }, true)
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
      const t0 = pos.current
      // smooth crouch transition
      const target = keys.ControlLeft || keys.ControlRight ? CROUCH_EYE : EYE
      eye.current += (target - eye.current) * Math.min(1, dt * 12)
      camera.position.set(t0.x, t0.y + eye.current, t0.z)
    }
    playerState.x = camera.position.x; playerState.y = camera.position.y; playerState.z = camera.position.z
    playerState.yaw = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ').y
    if (import.meta.env.DEV) (window as unknown as { __player?: unknown }).__player = { body: { x: pos.current.x, y: pos.current.y, z: pos.current.z }, cam: camera.position.toArray(), fly: fly.current, grounded: grounded.current, vy: vy.current }
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

    const collider = b.collider(0), cc = controller.current
    if (!collider || !cc) return
    const crouched = keys.ControlLeft || keys.ControlRight
    const speed = RUN * (crouched ? CROUCH_SPEED : keys.ShiftLeft ? 1.5 : 1)
    if (grounded.current && keys.Space) vy.current = JUMP
    vy.current -= GRAVITY * d
    cc.computeColliderMovement(collider, { x: wish.x * speed * d, y: vy.current * d, z: wish.z * speed * d })
    const mv = cc.computedMovement()
    grounded.current = cc.computedGrounded()
    // landing, or the head against a ceiling, cancels the vertical speed
    if ((grounded.current && vy.current < 0) || (vy.current > 0 && mv.y < vy.current * d - 1e-4)) vy.current = 0
    pos.current.add(mv as unknown as THREE.Vector3)
    b.setNextKinematicTranslation({ x: pos.current.x, y: pos.current.y, z: pos.current.z })
  })

  return (
    <>
      <RigidBody
        ref={body}
        type="kinematicPosition"
        colliders={false}
        position={spawn}
      >
        <CapsuleCollider args={[HALF, RADIUS]} friction={0} />
      </RigidBody>
      <PointerLockControls ref={controls as never} />
    </>
  )
}
