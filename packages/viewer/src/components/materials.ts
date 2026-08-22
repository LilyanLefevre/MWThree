import * as THREE from 'three'
import { materialColor } from '@mwthree/iw5-core'
import type { MapWorld } from '../types'
import type { TextureData } from '../worker/protocol'

const S3TC_FORMATS = {
  dxt1: THREE.RGBA_S3TC_DXT1_Format, dxt3: THREE.RGBA_S3TC_DXT3_Format, dxt5: THREE.RGBA_S3TC_DXT5_Format,
} as const

/** A color map: compressed (uploaded as is) or decoded RGBA. */
function colorTexture(data: TextureData): THREE.Texture {
  let tex: THREE.Texture
  if (data.compressed) {
    const mips = data.compressed.mips.map(m => ({ data: m.data, width: m.width, height: m.height }))
    tex = new THREE.CompressedTexture(mips as never, data.width, data.height, S3TC_FORMATS[data.compressed.kind])
    tex.minFilter = mips.length > 1 ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter
    tex.generateMipmaps = false
  } else {
    const rgba = data.rgba!
    tex = new THREE.DataTexture(new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength), data.width, data.height, THREE.RGBAFormat)
    tex.minFilter = THREE.LinearMipmapLinearFilter
    tex.generateMipmaps = true
  }
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.magFilter = THREE.LinearFilter
  tex.anisotropy = 4
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  return tex
}

/** One THREE material per game material name: textured when its color-map image was found, flat color otherwise. */
export function buildMaterials(world: Pick<MapWorld, 'materialImages' | 'materialNormals' | 'textures'>, names: Iterable<string>): { map: Map<string, THREE.Material>; textures: THREE.Texture[] } {
  const byImage = new Map(world.textures.filter(t => !t.normal).map(t => [t.name, t]))
  const normals = new Map(world.textures.filter(t => t.normal).map(t => [t.name, t]))
  const normalCache = new Map<string, THREE.DataTexture>()
  const texCache = new Map<string, THREE.Texture>()
  const map = new Map<string, THREE.Material>()
  for (const name of names) {
    const image = world.materialImages[name]
    const data = image ? byImage.get(image) : undefined
    if (data) {
      let tex = texCache.get(data.name)
      if (!tex) {
        tex = colorTexture(data)
        texCache.set(data.name, tex)
      }
      const nImage = world.materialNormals[name]
      const nData = nImage ? normals.get(nImage) : undefined
      let nTex: THREE.DataTexture | undefined
      if (nData) {
        nTex = normalCache.get(nData.name)
        if (!nTex) {
          nTex = new THREE.DataTexture(new Uint8Array(nData.rgba!.buffer, nData.rgba!.byteOffset, nData.rgba!.byteLength), nData.width, nData.height, THREE.RGBAFormat)
          nTex.wrapS = nTex.wrapT = THREE.RepeatWrapping
          nTex.magFilter = THREE.LinearFilter
          nTex.minFilter = THREE.LinearMipmapLinearFilter
          nTex.generateMipmaps = true
          nTex.needsUpdate = true
          normalCache.set(nData.name, nTex)
        }
      }
      map.set(name, new THREE.MeshLambertMaterial({
        map: tex, alphaTest: data.hasAlpha ? 0.5 : 0, side: data.hasAlpha ? THREE.DoubleSide : THREE.FrontSide,
        ...(nTex ? { normalMap: nTex, normalScale: new THREE.Vector2(1, 1) } : {}),
      }))
    } else {
      const [r, g, b] = materialColor(name)
      map.set(name, new THREE.MeshLambertMaterial({ color: new THREE.Color(r, g, b) }))
    }
  }
  return { map, textures: [...texCache.values(), ...normalCache.values()] }
}

/** World materials: lightmapped surfaces use an unlit material whose light comes from the lightmap atlas. */
export function buildWorldMaterials(world: MapWorld): { list: THREE.Material[]; textures: THREE.Texture[] } {
  const lit = buildMaterials(world, world.groups.map(g => g.material))
  const lmTex = world.lightmaps.map(l => {
    const t = new THREE.DataTexture(new Uint8Array(l.rgba.buffer, l.rgba.byteOffset, l.rgba.byteLength), l.width, l.height, THREE.RGBAFormat)
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
    t.magFilter = THREE.LinearFilter
    t.minFilter = THREE.LinearFilter
    t.channel = 1
    t.needsUpdate = true
    return t
  })
  const cache = new Map<string, THREE.Material>()
  const list = world.groups.map(g => {
    const base = lit.map.get(g.material)!
    const lm = g.lightmap !== undefined && g.lightmap >= 0 ? lmTex[g.lightmap] : undefined
    if (!lm && !g.decal) return base
    const key = `${g.material}|${g.lightmap}|${g.decal ? 'd' : ''}`
    let mat = cache.get(key)
    if (!mat) {
      const src = base as THREE.MeshLambertMaterial
      mat = new THREE.MeshBasicMaterial({
        map: src.map, color: src.map ? 0xffffff : src.color,
        ...(lm ? { lightMap: lm, lightMapIntensity: Math.PI } : {}),
        alphaTest: g.decal ? 0.02 : src.alphaTest, side: src.side,
        // decals are blended over the surface below with the vertex alpha
        ...(g.decal ? { vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 } : {}),
      })
      cache.set(key, mat)
    }
    return mat
  })
  return { list, textures: [...lit.textures, ...lmTex] }
}
