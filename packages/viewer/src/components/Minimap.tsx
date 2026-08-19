import { useEffect, useMemo, useRef } from 'react'
import { UNIT_SCALE } from '@mwthree/iw5-core'
import type { MapWorld } from '../types'
import { playerState } from '../playerState'
import { spawnColor } from './SpawnMarkers'
import { objectiveColor, objectiveText } from './Objectives'

const SIZE = 220

/** Top-down view of the playable area (bounded by the spawns), with spawns and the player. */
export function Minimap({ world }: { world: MapWorld }) {
  const canvas = useRef<HTMLCanvasElement>(null)

  // playable bounds in scene meters (x, z), from the spawns, with a margin
  const bounds = useMemo(() => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
    for (const s of world.spawns) {
      const x = s.origin[0] * UNIT_SCALE, z = -s.origin[1] * UNIT_SCALE
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z)
    }
    if (!Number.isFinite(x0)) return null
    const pad = 15, size = Math.max(x1 - x0, z1 - z0) + 2 * pad
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2
    return { x0: cx - size / 2, z0: cz - size / 2, size }
  }, [world.spawns])

  // background: world triangles shaded by height, rasterised once
  const background = useMemo(() => {
    if (!bounds) return null
    const c = document.createElement('canvas')
    c.width = c.height = SIZE
    const g = c.getContext('2d')!
    g.fillStyle = '#111'
    g.fillRect(0, 0, SIZE, SIZE)
    const p = world.positions, idx = world.indices
    let y0 = Infinity, y1 = -Infinity
    for (const s of world.spawns) { const y = s.origin[2] * UNIT_SCALE; y0 = Math.min(y0, y); y1 = Math.max(y1, y) }
    const k = SIZE / bounds.size
    const tris: [number, number][] = []
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3
      const y = (p[a + 1] + p[idx[t + 1] * 3 + 1] + p[idx[t + 2] * 3 + 1]) / 3
      tris.push([t, y])
    }
    tris.sort((u, v) => u[1] - v[1]) // draw from low to high so roofs end on top
    for (const [t, y] of tris) {
      const shade = Math.round(60 + 160 * Math.min(1, Math.max(0, (y - y0 + 2) / (y1 - y0 + 8))))
      g.fillStyle = `rgb(${shade},${shade},${shade})`
      g.beginPath()
      for (let k2 = 0; k2 < 3; k2++) {
        const v = idx[t + k2] * 3
        const sx = (p[v] - bounds.x0) * k, sy = (p[v + 2] - bounds.z0) * k
        if (k2 === 0) g.moveTo(sx, sy); else g.lineTo(sx, sy)
      }
      g.fill()
    }
    for (const s of world.spawns) {
      g.fillStyle = spawnColor(s.classname)
      g.fillRect((s.origin[0] * UNIT_SCALE - bounds.x0) * k - 1, (-s.origin[1] * UNIT_SCALE - bounds.z0) * k - 1, 2, 2)
    }
    g.font = 'bold 11px sans-serif'
    g.textAlign = 'center'; g.textBaseline = 'middle'
    for (const o of world.objectives) {
      const x = (o.origin[0] * UNIT_SCALE - bounds.x0) * k, y = (-o.origin[1] * UNIT_SCALE - bounds.z0) * k
      g.fillStyle = 'rgba(0,0,0,0.7)'; g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill()
      g.fillStyle = objectiveColor(o); g.fillText(objectiveText(o).slice(0, 2), x, y + 1)
    }
    return c
  }, [world, bounds])

  useEffect(() => {
    if (!bounds || !background) return
    let raf = 0
    const draw = () => {
      const g = canvas.current?.getContext('2d')
      if (g) {
        g.drawImage(background, 0, 0)
        const k = SIZE / bounds.size
        const x = (playerState.x - bounds.x0) * k, y = (playerState.z - bounds.z0) * k
        g.save()
        g.translate(x, y)
        g.rotate(-playerState.yaw)
        g.fillStyle = '#ffe14d'
        g.beginPath(); g.moveTo(0, -7); g.lineTo(5, 5); g.lineTo(-5, 5); g.closePath(); g.fill()
        g.restore()
      }
      raf = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [bounds, background])

  if (!bounds) return null
  return (
    <canvas ref={canvas} width={SIZE} height={SIZE} style={{
      position: 'absolute', left: 10, bottom: 40, zIndex: 100, border: '1px solid #444', borderRadius: 4, opacity: 0.9,
    }} />
  )
}
