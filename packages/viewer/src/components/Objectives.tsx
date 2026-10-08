import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { UNIT_SCALE } from '@mwthree/iw5-core'
import type { Objective } from '@mwthree/iw5-core'

export function objectiveColor(o: Objective): string {
  switch (o.kind) {
    case 'domination': return '#f2f2f2'
    case 'bombzone': return '#ff7a1a'
    case 'ctf_flag': return o.label === 'axis' ? '#ff4d4d' : '#3d8bff'
    case 'headquarters': return '#38d16a'
    case 'sabotage': return '#c06bff'
  }
}

export function objectiveText(o: Objective): string {
  if (o.kind === 'ctf_flag') return '⚑'
  if (o.kind === 'sabotage') return 'SAB'
  return o.label
}

/** Floating label sprite (and the capture radius for domination flags) for each game-mode objective. */
export function Objectives({ objectives }: { objectives: Objective[] }) {
  const group = useMemo(() => {
    const g = new THREE.Group()
    for (const o of objectives) {
      const [x, y, z] = o.origin
      const pos = new THREE.Vector3(x * UNIT_SCALE, z * UNIT_SCALE, -y * UNIT_SCALE)
      const color = objectiveColor(o)

      const c = document.createElement('canvas')
      c.width = c.height = 128
      const ctx = c.getContext('2d')!
      ctx.fillStyle = 'rgba(0,0,0,0.55)'
      ctx.beginPath(); ctx.arc(64, 64, 58, 0, Math.PI * 2); ctx.fill()
      ctx.lineWidth = 8; ctx.strokeStyle = color; ctx.stroke()
      ctx.fillStyle = color
      ctx.font = `bold ${objectiveText(o).length > 2 ? 40 : 64}px sans-serif`
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(objectiveText(o), 64, 68)
      const tex = new THREE.CanvasTexture(c)
      tex.colorSpace = THREE.SRGBColorSpace
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, sizeAttenuation: false }))
      sprite.scale.setScalar(0.06)
      sprite.position.copy(pos).add(new THREE.Vector3(0, 2.2, 0))
      sprite.renderOrder = 20
      g.add(sprite)

      if (o.kind === 'domination' && o.radius) {
        const r = o.radius * UNIT_SCALE, h = (o.height ?? 128) * UNIT_SCALE
        const ring = new THREE.Mesh(
          new THREE.CylinderGeometry(r, r, h, 48, 1, true),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }),
        )
        ring.position.copy(pos).add(new THREE.Vector3(0, h / 2, 0))
        g.add(ring)
      }
    }
    return g
  }, [objectives])
  useEffect(() => () => {
    group.traverse(o => {
      const m = o as THREE.Mesh
      m.geometry?.dispose()
      const mat = m.material as THREE.SpriteMaterial | undefined
      mat?.map?.dispose(); mat?.dispose()
    })
  }, [group])
  return <primitive object={group} />
}
