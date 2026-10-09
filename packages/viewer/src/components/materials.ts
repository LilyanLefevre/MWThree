import * as THREE from 'three'
import { materialColor, UNIT_SCALE, type Fog, type MaterialBlend } from '@mwthree/iw5-core'
import type { MapWorld } from '../types'
import type { TextureData } from '../worker/protocol'

const S3TC_FORMATS = {
  dxt1: THREE.RGBA_S3TC_DXT1_Format, dxt3: THREE.RGBA_S3TC_DXT3_Format, dxt5: THREE.RGBA_S3TC_DXT5_Format,
} as const

/**
 * The engine's exponential fog (lib/fog.hlsli): transmittance T = clamp(exp(−(d − start)·ln2/halfway), 1 − maxOpacity, 1)
 * with d the distance to the camera, color = mix(fog, lit, T) in linear space. Uniforms shared by every world/prop material.
 */
const fogUniforms = { iwFog: { value: new THREE.Vector3(0, 0, 1) }, iwFogColor: { value: new THREE.Color() } }

export function setFog(fog: Fog | null) {
  if (!fog) { fogUniforms.iwFog.value.set(0, 0, 1); return }
  fogUniforms.iwFog.value.set(fog.startDist * UNIT_SCALE, Math.LN2 / (fog.halfwayDist * UNIT_SCALE), 1 - fog.maxOpacity)
  fogUniforms.iwFogColor.value.setRGB(...fog.color, THREE.SRGBColorSpace)
}

export function addFog(shader: THREE.WebGLProgramParametersWithUniforms) {
  Object.assign(shader.uniforms, fogUniforms)
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying float vIwFogDist;')
    .replace('#include <project_vertex>', '#include <project_vertex>\nvIwFogDist = length(mvPosition.xyz);')
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform vec3 iwFog;\nuniform vec3 iwFogColor;\nvarying float vIwFogDist;')
    .replace('#include <tonemapping_fragment>',
      'gl_FragColor.rgb = mix(iwFogColor, gl_FragColor.rgb, clamp(exp(-(vIwFogDist - iwFog.x) * iwFog.y), iwFog.z, 1.0));\n#include <tonemapping_fragment>')
}

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
/** `worldSurfaces`: the world mesh, whose vertex colors (alpha) fade blended layers; props have none. */
export function buildMaterials(world: Pick<MapWorld, 'materialImages' | 'materialNormals' | 'textures' | 'materialBlends' | 'opaqueMaterials'>, names: Iterable<string>, worldSurfaces = false): { map: Map<string, THREE.Material>; textures: THREE.Texture[] } {
  const byImage = new Map(world.textures.filter(t => !t.normal).map(t => [t.name, t]))
  const normals = new Map(world.textures.filter(t => t.normal).map(t => [t.name, t]))
  const normalCache = new Map<string, THREE.DataTexture>()
  const texCache = new Map<string, THREE.Texture>()
  const map = new Map<string, THREE.Material>()
  const opaque = new Set(world.opaqueMaterials)
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
      const blend = world.materialBlends[name]
      if (blend) { map.set(name, blendedMaterial(tex, blend, worldSurfaces)); continue }
      const cutout = data.hasAlpha && !opaque.has(name)
      map.set(name, new THREE.MeshLambertMaterial({
        map: tex, alphaTest: cutout ? 0.5 : 0, side: cutout ? THREE.DoubleSide : THREE.FrontSide,
        ...(nTex ? { normalMap: nTex, normalScale: new THREE.Vector2(1, 1) } : {}),
      }))
    } else if (world.materialBlends[name]) {
      map.set(name, blendedMaterial(undefined, world.materialBlends[name], worldSurfaces))
      continue
    } else {
      const [r, g, b] = materialColor(name)
      map.set(name, new THREE.MeshLambertMaterial({ color: new THREE.Color(r, g, b) }))
    }
    map.get(name)!.onBeforeCompile = addFog
  }
  return { map, textures: [...texCache.values(), ...normalCache.values()] }
}

/**
 * The engine's lightmap shading (see extractLightmaps): ambient (2·rgb)² plus the sun where the primary (alpha)
 * says it is visible, with the surface normal.
 */
function applyLightmapShading(mat: THREE.Material, sun: MapWorld['sun']) {
  const dir = new THREE.Vector3(...(sun?.direction ?? [0.3, 0.8, 0.5])).normalize()
  const color = new THREE.Vector3(...(sun?.color ?? [1, 1, 1]))
  mat.onBeforeCompile = shader => {
    addFog(shader)
    shader.uniforms.uSunDir = { value: dir }
    shader.uniforms.uSunColor = { value: color }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWorldNormal = normalize(mat3(modelMatrix) * normal);')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldNormal;\nuniform vec3 uSunDir;\nuniform vec3 uSunColor;')
      .replace('reflectedLight.indirectDiffuse += lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI;',
        'reflectedLight.indirectDiffuse += 4.0 * lightMapTexel.rgb * lightMapTexel.rgb'
        + ' + lightMapTexel.a * max(dot(normalize(vWorldNormal), uSunDir), 0.0) * uSunColor;')
  }
  mat.customProgramCacheKey = () => 'iw-lightmap'
}

// src·srcFactor + dst·dstFactor for each unlit technique blend
const BLEND_FACTORS = {
  add: [THREE.OneFactor, THREE.OneFactor],
  screen: [THREE.OneFactor, THREE.OneMinusSrcColorFactor],
  multiply: [THREE.DstColorFactor, THREE.ZeroFactor],
} as const

/**
 * Unlit blended layer (`wc_unlit_*` techniques): not lit by the lightmap, color = texture × vertex color.
 * add/screen fade to black with the alpha (premultiplied), multiply fades to white; `falloff` also fades the layer
 * as it turns edge-on (god rays).
 */
function blendedMaterial(map: THREE.Texture | undefined, { blend, falloff, linear }: MaterialBlend, vertexColors: boolean): THREE.Material {
  const [blendSrc, blendDst] = BLEND_FACTORS[blend]
  if (map && linear) { map = map.clone(); map.colorSpace = THREE.NoColorSpace; map.needsUpdate = true }
  const mat = new THREE.MeshBasicMaterial({
    // without its texture, the layer is left out: black adds nothing, white multiplies by one
    ...(map ? { map } : {}), color: map || blend === 'multiply' ? 0xffffff : 0x000000, vertexColors, side: THREE.DoubleSide,
    transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc, blendDst,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  })
  const fade = falloff ? ' * vFacing' : ''
  mat.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vFacing;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec3 facingNormal = normal;
        #ifdef USE_INSTANCING
          facingNormal = mat3(instanceMatrix) * facingNormal;
        #endif
        vFacing = abs(dot(normalize(normalMatrix * facingNormal), normalize(-mvPosition.xyz)));`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFacing;')
      .replace('#include <opaque_fragment>', (blend === 'multiply'
        ? `outgoingLight = mix(vec3(1.0), outgoingLight, diffuseColor.a${fade});`
        : `outgoingLight *= diffuseColor.a${fade};`) + '\ndiffuseColor.a = 1.0;\n#include <opaque_fragment>')
  }
  mat.customProgramCacheKey = () => `iw-blend-${blend}-${falloff}`
  return mat
}

/** World materials: lightmapped surfaces use an unlit material whose light comes from the lightmap atlas. */
export function buildWorldMaterials(world: MapWorld): { list: THREE.Material[]; textures: THREE.Texture[] } {
  const lit = buildMaterials(world, world.groups.map(g => g.material), true)
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
    if ((!lm && !g.decal && !g.overlay) || world.materialBlends[g.material]) return base
    const key = `${g.material}|${g.lightmap}|${g.decal ? 'd' : g.overlay ? 'o' : ''}`
    let mat = cache.get(key)
    if (!mat) {
      const src = base as THREE.MeshLambertMaterial
      mat = new THREE.MeshBasicMaterial({
        map: src.map, color: src.map ? 0xffffff : src.color,
        ...(lm ? { lightMap: lm } : {}),
        alphaTest: g.decal ? 0.02 : src.alphaTest, side: src.side,
        // decals are blended over the surface below with the vertex alpha
        ...(g.decal ? { vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 } : {}),
        // opaque layers over another surface only need to win the depth test
        ...(g.overlay ? { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 } : {}),
      })
      if (lm) applyLightmapShading(mat, world.sun)
      else mat.onBeforeCompile = addFog
      cache.set(key, mat)
    }
    return mat
  })
  return { list, textures: [...lit.textures, ...lmTex] }
}
