import * as THREE from 'three'
import { materialColor } from '@mwthree/iw5-core'
import type { MapWorld } from '../types'

/** One THREE material per game material name: textured when its color-map image was found, flat color otherwise. */
export function buildMaterials(world: Pick<MapWorld, 'materialImages' | 'textures'>, names: Iterable<string>): { map: Map<string, THREE.Material>; textures: THREE.Texture[] } {
  const byImage = new Map(world.textures.map(t => [t.name, t]))
  const texCache = new Map<string, THREE.DataTexture>()
  const map = new Map<string, THREE.Material>()
  for (const name of names) {
    const image = world.materialImages[name]
    const data = image ? byImage.get(image) : undefined
    if (data) {
      let tex = texCache.get(data.name)
      if (!tex) {
        tex = new THREE.DataTexture(new Uint8Array(data.rgba.buffer, data.rgba.byteOffset, data.rgba.byteLength), data.width, data.height, THREE.RGBAFormat)
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping
        tex.magFilter = THREE.LinearFilter
        tex.minFilter = THREE.LinearMipmapLinearFilter
        tex.generateMipmaps = true
        tex.anisotropy = 4
        tex.colorSpace = THREE.SRGBColorSpace
        tex.needsUpdate = true
        texCache.set(data.name, tex)
      }
      map.set(name, new THREE.MeshLambertMaterial({
        map: tex, alphaTest: data.hasAlpha ? 0.5 : 0, side: data.hasAlpha ? THREE.DoubleSide : THREE.FrontSide,
      }))
    } else {
      const [r, g, b] = materialColor(name)
      map.set(name, new THREE.MeshLambertMaterial({ color: new THREE.Color(r, g, b) }))
    }
  }
  return { map, textures: [...texCache.values()] }
}
