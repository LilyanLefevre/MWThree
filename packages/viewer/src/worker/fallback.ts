/**
 * Stand-in textures (CC0, from ambientCG, see public/fallback/README.md) for images the loaded archives do not have, so a map
 * shown without the game's own files still looks like something. Picked from keywords in the image name.
 */
const KINDS: [RegExp, string][] = [
  [/rust|corrod/, 'rust'], [/brick|tile|stone|wall_/, 'brick'], [/wood|plank|plywood|crate|board|door/, 'wood'],
  [/metal|steel|iron|contain|cargo|pipe|grate|sign|vent|truck|car_|vehicle/, 'metal'], [/asphalt|road|street|tar/, 'asphalt'],
  [/sand|dirt|gravel|desert|rock|cliff/, 'sand'], [/grass|ground|mud|terrain|foliage|leaf/, 'ground'],
]
const cache = new Map<string, Promise<{ width: number; height: number; rgba: Uint8Array } | null>>()

const load = (kind: string) => {
  let p = cache.get(kind)
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}fallback/${kind}.jpg`).then(r => r.blob()).then(createImageBitmap).then(bmp => {
      const ctx = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d')!
      ctx.drawImage(bmp, 0, 0)
      return { width: bmp.width, height: bmp.height, rgba: new Uint8Array(ctx.getImageData(0, 0, bmp.width, bmp.height).data.buffer) }
    }).catch(() => null)
    cache.set(kind, p)
  }
  return p
}

export const fallbackTexture = (name: string) => load(KINDS.find(([re]) => re.test(name.toLowerCase()))?.[1] ?? 'concrete')
