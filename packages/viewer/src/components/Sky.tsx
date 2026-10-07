import { useEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { MapWorld } from '../types'

/** The map's sky as the scene background (equirectangular image built from its cube map). */
export function Sky({ sky }: { sky: NonNullable<MapWorld['sky']> }) {
  const scene = useThree(s => s.scene)
  const texture = useMemo(() => {
    const t = new THREE.DataTexture(new Uint8Array(sky.rgba.buffer, sky.rgba.byteOffset, sky.rgba.byteLength), sky.width, sky.height, THREE.RGBAFormat)
    t.mapping = THREE.EquirectangularReflectionMapping
    t.colorSpace = THREE.SRGBColorSpace
    t.magFilter = THREE.LinearFilter
    t.minFilter = THREE.LinearFilter
    t.needsUpdate = true
    return t
  }, [sky])
  useEffect(() => {
    const previous = scene.background
    scene.background = texture
    return () => { scene.background = previous; texture.dispose() }
  }, [scene, texture])
  return null
}
