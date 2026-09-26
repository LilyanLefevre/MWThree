/** Retail names of the multiplayer maps, by zone code name. */
const NAMES: Record<string, string> = {
  alpha: 'Lockdown', bootleg: 'Bootleg', bravo: 'Mission', carbon: 'Carbon', dome: 'Dome', exchange: 'Downturn',
  hardhat: 'Hardhat', interchange: 'Interchange', lambeth: 'Fallen', mogadishu: 'Bakaara', paris: 'Resistance',
  plaza2: 'Arkaden', radar: 'Outpost', seatown: 'Seatown', underground: 'Underground', village: 'Village',
}

/**
 * Line shown under the map name on the loading screen.
 * Placeholders: the game's own strings live in zone/english/*.ff (localized), not in the files read here.
 */
const PLACES: Record<string, string> = {
  alpha: 'Centre-ville bouclé', bootleg: 'Quartier de contrebande sous la pluie', bravo: 'Village fortifié à flanc de colline',
  carbon: 'Raffinerie de pétrole', dome: 'Avant-poste militaire désaffecté dans le désert', exchange: 'Quartier financier de New York',
  hardhat: 'Chantier de construction', interchange: 'Échangeur autoroutier effondré', lambeth: 'Ville en ruines',
  mogadishu: 'Marché de Mogadiscio', paris: 'Rues de Paris', plaza2: 'Centre commercial de Berlin',
  radar: 'Station radar dans la neige', seatown: 'Ville côtière', underground: 'Station de métro de Londres',
  village: 'Village de montagne',
}

/** "mp_lambeth.ff" or "lambeth" -> "lambeth". */
export const mapCode = (fileName: string) => fileName.replace(/^mp_/, '').replace(/\.ff$/, '')

/** Names of community maps, from their .arena file (`longname`); filled when the maps are listed. */
const customNames = new Map<string, string>()
export const registerMapName = (code: string, name: string | undefined) => { if (name) customNames.set(code, name) }

/** "mp_lambeth.ff" -> "Fallen"; community maps use their arena name, else the code ("rust_long" -> "Rust Long"). */
export function mapDisplayName(fileName: string): string {
  const code = mapCode(fileName)
  return NAMES[code] ?? customNames.get(code) ?? code.replace(/_/g, ' ').replace(/\b[a-z]/g, c => c.toUpperCase())
}

/** Loading-screen images to try, best first: community maps often name theirs after a shorter code (mp_rust_long -> loadscreen_mp_rust). */
export function loadscreenNames(fileName: string): string[] {
  const parts = mapCode(fileName).split('_')
  return parts.map((_, i) => `loadscreen_mp_${parts.slice(0, parts.length - i).join('_')}`)
}

/** Lobby preview, falling back to the loading screen (community maps rarely ship a preview). */
export const previewNames = (fileName: string) => [`preview_mp_${mapCode(fileName)}_lobby`, `preview_mp_${mapCode(fileName)}`, ...loadscreenNames(fileName)]

/** Loading screen subtitle, empty for unknown maps. */
export const mapPlace = (fileName: string) => PLACES[mapCode(fileName)] ?? ''
