import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { UNIT_SCALE } from '@mwthree/iw5-core'
import type { SpawnPoint } from '../worker/protocol'
import { spawnColor } from '../markers'

/** One cone per spawn point, pointing in its yaw direction, colored by team. */
export function SpawnMarkers({ spawns }: { spawns: SpawnPoint[] }) {
  const mesh = useMemo(() => {
    const geo = new THREE.ConeGeometry(0.15, 0.45, 8).rotateX(Math.PI / 2) // tip along +Z
    const mat = new THREE.MeshBasicMaterial()
    const m = new THREE.InstancedMesh(geo, mat, spawns.length)
    const o = new THREE.Object3D()
    const color = new THREE.Color()
    spawns.forEach((s, i) => {
      const [x, y, z] = s.origin
      o.position.set(x * UNIT_SCALE, z * UNIT_SCALE + 2, -y * UNIT_SCALE)
      // game yaw is CCW from +X; the cone points along +Z before rotation
      o.rotation.set(0, (s.angles[1] * Math.PI) / 180 + Math.PI / 2, 0)
      o.updateMatrix()
      m.setMatrixAt(i, o.matrix)
      m.setColorAt(i, color.set(spawnColor(s.classname)))
    })
    m.frustumCulled = false
    return m
  }, [spawns])
  useEffect(() => () => { mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); mesh.dispose() }, [mesh])
  return <primitive object={mesh} />
}
