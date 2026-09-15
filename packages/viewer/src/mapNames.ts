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

/** "mp_lambeth.ff" -> "Fallen" (falls back to the code name). */
export function mapDisplayName(fileName: string): string {
  const code = mapCode(fileName)
  return NAMES[code] ?? code
}

/** Loading screen subtitle, empty for unknown maps. */
export const mapPlace = (fileName: string) => PLACES[mapCode(fileName)] ?? ''
