import { describe, it, expect } from 'vitest'
import { unscrambleHeader } from './ZoneLoader.js'
import { parseEntities } from './MapExtract.js'

/** The forward transform, written from its description: 4 rounds of b = ~b ^ key[(round * size + i) % keyLength] ^ round. */
function scramble(bytes: Uint8Array, zoneName: string): void {
  const key = new TextEncoder().encode(`${zoneName}: This fastfile is property of the Plutonium Project.`)
  for (let round = 0; round < 4; round++) {
    for (let i = 0; i < bytes.length; i++) bytes[i] = (~bytes[i] ^ key[(round * bytes.length + i) % key.length] ^ round) & 0xff
  }
}

describe('ZoneTool header scrambling', () => {
  it('unscrambles what the forward transform scrambled, for any struct size', () => {
    for (const size of [8, 116, 228, 256, 640]) {
      const clear = new Uint8Array(size).map((_, i) => (i * 31 + 7) & 0xff)
      clear.fill(0xff, 0, 4)
      const bytes = clear.slice()
      scramble(bytes, 'mp_rust_long')
      expect(bytes).not.toEqual(clear)
      unscrambleHeader(bytes, 'mp_rust_long')
      expect(bytes).toEqual(clear)
    }
  })

  it('leaves a struct unchanged when its size is a multiple of the key length (the 4 rounds cancel out)', () => {
    // "mp_shipment" + ": This fastfile is property of the Plutonium Project." = 64 bytes of key: clipMap_t (256 bytes) stays clear
    const clear = new Uint8Array(256).map((_, i) => (i * 13 + 5) & 0xff)
    const bytes = clear.slice()
    scramble(bytes, 'mp_shipment')
    expect(bytes).toEqual(clear)
  })

  it('does not unscramble with another zone name', () => {
    const clear = new Uint8Array(64).fill(0xff)
    const bytes = clear.slice()
    scramble(bytes, 'mp_one')
    unscrambleHeader(bytes, 'mp_two')
    expect(bytes).not.toEqual(clear)
  })
})

describe('parseEntities', () => {
  const bytes = (s: string) => Array.from(new TextEncoder().encode(s))

  it('reads the plain text format of community maps', () => {
    const ents = parseEntities(bytes('{\n"classname" "worldspawn"\n"sundirection" "-43 51.5 0"\n}\n{\n"origin" "164 -591 220"\n"classname" "mp_dm_spawn"\n}\n'))
    expect(ents).toHaveLength(2)
    expect(ents[0].classname).toBe('worldspawn')
    expect(ents[1]).toMatchObject({ classname: 'mp_dm_spawn', origin: '164 -591 220' })
  })

  it("reads the game's numeric key format", () => {
    const ents = parseEntities(bytes('{\n1668 "mp_dm_spawn"\n1669 "164 -591 220"\n}\n'))
    expect(ents).toHaveLength(1)
    expect(ents[0].classname).toBe('mp_dm_spawn')
    expect(ents[0].origin).toBe('164 -591 220')
  })
})
