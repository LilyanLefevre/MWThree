import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { PROP_LIGHT_STRIDE, type ModelGeometry } from '@mwthree/iw5-core'
import type { MapWorld } from '../types'
import type { StaticModelData } from '../worker/protocol'
import { buildMaterials } from './materials'

const LOD_REFRESH = 0.25 // seconds between near/far reassignments
/** dev/testing: ?nolod draws every instance with LOD 0 */
const NO_LOD = import.meta.env.DEV && new URLSearchParams(location.search).has('nolod')

function makeGeometry(d: ModelGeometry): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(d.positions, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(d.normals, 3))
  g.setAttribute('uv', new THREE.BufferAttribute(d.uvs, 2))
  g.setIndex(new THREE.BufferAttribute(d.indices, 1))
  d.groups.forEach((grp, i) => g.addGroup(grp.start, grp.count, i))
  return g
}

function makeMesh(geometry: THREE.BufferGeometry, groups: ModelGeometry['groups'], mats: Map<string, THREE.Material>, count: number): THREE.InstancedMesh {
  const light = new THREE.InstancedInterleavedBuffer(new Float32Array(count * PROP_LIGHT_STRIDE), PROP_LIGHT_STRIDE)
  for (let i = 0; i < 6; i++) geometry.setAttribute(`aLight${i}`, new THREE.InterleavedBufferAttribute(light, 4, i * 4))
  const m = new THREE.InstancedMesh(geometry, groups.map(g => mats.get(g.material)!), count)
  m.frustumCulled = false // the bounding sphere is the model's, not the instances'
  return m
}

const lightBuffer = (m: THREE.InstancedMesh) => (m.geometry.getAttribute('aLight0') as THREE.InterleavedBufferAttribute).data
const lightOf = (m: THREE.InstancedMesh) => lightBuffer(m).array as Float32Array

/** sun term gain (sun color as authored, ~1.2) and overall gain, calibrated against the lightmapped world */
const SUN_GAIN = 0.55
const PROP_GAIN = 1.0

/**
 * Light props like the engine's model lighting: ambient cube from the light grid sample of each instance
 * (aLight0..5 = scene +X, −X, +Y, −Y, +Z, −Z) plus the sun, scaled by the share of the sample that sees it (aLight0.w).
 */
function applyGridLighting(mat: THREE.Material, sun: MapWorld['sun']) {
  const dir = new THREE.Vector3(...(sun?.direction ?? [0.3, 0.8, 0.5])).normalize()
  const color = new THREE.Vector3(...(sun?.color ?? [1, 1, 1])).multiplyScalar(SUN_GAIN)
  mat.onBeforeCompile = shader => {
    shader.uniforms.uSunDir = { value: dir }
    shader.uniforms.uSunColor = { value: color }
    const v = [0, 1, 2, 3, 4, 5]
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${v.map(i => `attribute vec4 aLight${i};\nvarying vec4 vLight${i};`).join('\n')}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${v.map(i => `vLight${i} = aLight${i};`).join('\n')}`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform vec3 uSunDir;\nuniform vec3 uSunColor;\n${v.map(i => `varying vec4 vLight${i};`).join('\n')}`)
      .replace('#include <opaque_fragment>', `
        vec3 wn = inverseTransformDirection(normal, viewMatrix);
        vec3 n2 = wn * wn;
        vec3 amb = n2.x * (wn.x > 0.0 ? vLight0.rgb : vLight1.rgb)
                 + n2.y * (wn.y > 0.0 ? vLight2.rgb : vLight3.rgb)
                 + n2.z * (wn.z > 0.0 ? vLight4.rgb : vLight5.rgb);
        outgoingLight = diffuseColor.rgb * (amb + uSunColor * max(dot(wn, uSunDir), 0.0) * vLight0.w) * ${PROP_GAIN.toFixed(2)};
        #include <opaque_fragment>`)
  }
  mat.customProgramCacheKey = () => 'grid-lit'
}

/**
 * One model: LOD 0 instanced mesh, plus a LOD 1 mesh for the instances farther than the model's switch
 * distance (instances are redistributed between the two a few times per second).
 */
function Batch({ data, mats }: { data: StaticModelData; mats: Map<string, THREE.Material> }) {
  const n = data.matrices.length / 16
  const meshes = useMemo(() => {
    const near = makeMesh(makeGeometry(data), data.groups, mats, n)
    const far = data.far ? makeMesh(makeGeometry(data.far), data.far.groups, mats, n) : null
    // until the first LOD pass, everything is drawn with LOD 0
    ;(near.instanceMatrix.array as Float32Array).set(data.matrices)
    lightOf(near).set(data.instanceLight)
    if (far) far.count = 0
    return { near, far }
  }, [data, mats, n])
  useEffect(() => () => {
    for (const m of [meshes.near, meshes.far]) { if (m) { m.geometry.dispose(); m.dispose() } }
  }, [meshes])

  const timer = useRef(0)
  useFrame(({ camera }, dt) => {
    const { near, far } = meshes
    if (!far || !data.farDistance || NO_LOD) return
    timer.current -= dt
    if (timer.current > 0) return
    timer.current = LOD_REFRESH
    const d2 = data.farDistance * data.farDistance
    const m = data.matrices, c = data.instanceLight, L = PROP_LIGHT_STRIDE
    const nm = near.instanceMatrix.array as Float32Array, fm = far.instanceMatrix.array as Float32Array
    const nc = lightOf(near), fc = lightOf(far)
    let ni = 0, fi = 0
    const { x, y, z } = camera.position
    for (let i = 0; i < n; i++) {
      const dx = m[i * 16 + 12] - x, dy = m[i * 16 + 13] - y, dz = m[i * 16 + 14] - z
      const isFar = dx * dx + dy * dy + dz * dz > d2
      const k = isFar ? fi++ : ni++
      ;(isFar ? fm : nm).set(m.subarray(i * 16, i * 16 + 16), k * 16)
      ;(isFar ? fc : nc).set(c.subarray(i * L, i * L + L), k * L)
    }
    near.count = ni; far.count = fi
    near.instanceMatrix.needsUpdate = far.instanceMatrix.needsUpdate = true
    lightBuffer(near).needsUpdate = lightBuffer(far).needsUpdate = true
  })

  return (
    <>
      <primitive object={meshes.near} />
      {meshes.far && <primitive object={meshes.far} />}
    </>
  )
}

/** Static props (crates, vehicles, foliage…), instanced per model with two levels of detail. */
export function StaticModels({ world }: { world: MapWorld }) {
  const built = useMemo(() => {
    const names = new Set<string>()
    for (const m of world.staticModels) {
      for (const g of m.groups) names.add(g.material)
      for (const g of m.far?.groups ?? []) names.add(g.material)
    }
    const built = buildMaterials(world, names)
    built.map.forEach(m => applyGridLighting(m, world.sun))
    return built
  }, [world])
  useEffect(() => () => { built.map.forEach(m => m.dispose()); built.textures.forEach(t => t.dispose()) }, [built])
  return <>{world.staticModels.map((m, i) => <Batch key={`${m.name}-${i}`} data={m} mats={built.map} />)}</>
}
