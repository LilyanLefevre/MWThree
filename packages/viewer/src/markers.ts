// Colors and labels shared by the 3D markers and the minimap.
import type { Objective } from '@mwthree/iw5-core'

export function spawnColor(classname: string): string {
  if (/allies/.test(classname)) return '#3d8bff'
  if (/axis/.test(classname)) return '#ff4d4d'
  if (/mp_dm_spawn/.test(classname)) return '#38d16a'
  return '#ffc53d'
}

export function objectiveColor(o: Objective): string {
  switch (o.kind) {
    case 'domination': return '#f2f2f2'
    case 'bombzone': return '#ff7a1a'
    case 'ctf_flag': return o.label === 'axis' ? '#ff4d4d' : '#3d8bff'
    case 'headquarters': return '#38d16a'
    case 'sabotage': return '#c06bff'
  }
}

export function objectiveText(o: Objective): string {
  if (o.kind === 'ctf_flag') return '⚑'
  if (o.kind === 'sabotage') return 'SAB'
  return o.label
}

export function triggerColor(classname: string): string {
  if (classname === 'trigger_hurt') return '#ff3b3b'
  if (classname === 'trigger_use_touch') return '#ff9f1a'
  if (classname === 'trigger_radius') return '#2ad4ff'
  return '#ffe14d'
}
