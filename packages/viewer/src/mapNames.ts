/** Retail names of the multiplayer maps, by zone code name. */
const NAMES: Record<string, string> = {
  alpha: 'Lockdown', bootleg: 'Bootleg', bravo: 'Mission', carbon: 'Carbon', dome: 'Dome', exchange: 'Downturn',
  hardhat: 'Hardhat', interchange: 'Interchange', lambeth: 'Fallen', mogadishu: 'Bakaara', paris: 'Resistance',
  plaza2: 'Arkaden', radar: 'Outpost', seatown: 'Seatown', underground: 'Underground', village: 'Village',
}

/** "mp_lambeth.ff" -> "Fallen" (falls back to the code name). */
export function mapDisplayName(fileName: string): string {
  const code = fileName.replace(/^mp_/, '').replace(/\.ff$/, '')
  return NAMES[code] ?? code
}
