import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'

/** Dev only: exposes frame rate and draw statistics on window.__render (used by automated checks). */
export function RenderStats() {
  const acc = useRef({ t: 0, frames: 0 })
  useFrame(({ gl }, dt) => {
    acc.current.t += dt
    acc.current.frames++
    if (acc.current.t < 1) return
    ;(window as unknown as { __render?: unknown }).__render = {
      fps: Math.round(acc.current.frames / acc.current.t),
      triangles: gl.info.render.triangles,
      calls: gl.info.render.calls,
    }
    acc.current = { t: 0, frames: 0 }
  })
  return null
}
