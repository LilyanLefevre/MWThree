import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { UNIT_SCALE } from '@mwthree/iw5-core'
import type { TriggerVolume } from '@mwthree/iw5-core'
import { triggerColor } from '../markers'

/** Outlines of the brush triggers (bomb sites, pickups, hurt zones…), colored by class. */
export function Triggers({ triggers }: { triggers: TriggerVolume[] }) {
  const group = useMemo(() => {
    const g = new THREE.Group()
    const byColor = new Map<string, number[]>()
    for (const t of triggers) {
      const list = byColor.get(triggerColor(t.classname)) ?? []
      // game (x, y, z) -> scene (x, z, -y)
      for (let i = 0; i < t.edges.length; i += 3) list.push(t.edges[i] * UNIT_SCALE, t.edges[i + 2] * UNIT_SCALE, -t.edges[i + 1] * UNIT_SCALE)
      byColor.set(triggerColor(t.classname), list)
    }
    for (const [color, pts] of byColor) {
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3))
      const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.8 }))
      lines.renderOrder = 15
      lines.frustumCulled = false
      g.add(lines)
    }
    return g
  }, [triggers])
  useEffect(() => () => {
    group.children.forEach(c => { const l = c as THREE.LineSegments; l.geometry.dispose(); (l.material as THREE.Material).dispose() })
  }, [group])
  return <primitive object={group} />
}
