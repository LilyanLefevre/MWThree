import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { UNIT_SCALE } from '@mwthree/iw5-core'
import type { TriggerVolume } from '@mwthree/iw5-core'
import { triggerColor } from '../markers'

/** Wireframe boxes of the brush triggers (bomb sites, pickups, hurt zones…), colored by class. */
export function Triggers({ triggers }: { triggers: TriggerVolume[] }) {
  const group = useMemo(() => {
    const g = new THREE.Group()
    const unit = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1))
    const mats = new Map<string, THREE.LineBasicMaterial>()
    for (const t of triggers) {
      const color = triggerColor(t.classname)
      let mat = mats.get(color)
      if (!mat) mats.set(color, mat = new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.8 }))
      for (const b of t.boxes) {
        const box = new THREE.LineSegments(unit, mat)
        // game (x, y, z) -> scene (x, z, -y)
        box.position.set(b.center[0] * UNIT_SCALE, b.center[2] * UNIT_SCALE, -b.center[1] * UNIT_SCALE)
        box.scale.set(b.half[0] * 2 * UNIT_SCALE, b.half[2] * 2 * UNIT_SCALE, b.half[1] * 2 * UNIT_SCALE)
        box.renderOrder = 15
        g.add(box)
      }
    }
    g.userData.dispose = () => { unit.dispose(); mats.forEach(m => m.dispose()) }
    return g
  }, [triggers])
  useEffect(() => () => group.userData.dispose(), [group])
  return <primitive object={group} />
}
