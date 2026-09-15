import { mapDisplayName, mapPlace } from '../mapNames'
import type { Layers } from './Hud'

const KEYS: [string, string][] = [
  ['Clic', 'capturer la souris'], ['ZQSD / WASD', 'se déplacer'], ['Espace', 'sauter (monter en vol)'], ['Maj', 'sprint'],
  ['Ctrl', 'accroupi (descendre en vol)'], ['V', 'vol libre / marche'], ['T / Maj+T', 'spawn suivant / précédent'],
  ['C · O · B · G', 'collision · spawns · objectifs · triggers'], ['I', 'panneau technique'], ['Échap', 'ce menu'],
]

const LAYER_LABELS: [keyof Layers, string, string][] = [
  ['objectives', 'Objectifs des modes de jeu', 'B'], ['spawns', 'Points de spawn', 'O'],
  ['triggers', 'Volumes des triggers', 'G'], ['collision', 'Collision', 'C'],
]

export interface PauseMenuProps {
  file: string
  layers: Layers
  onToggle: (layer: keyof Layers) => void
  /** its click also captures the pointer again */
  onResume: () => void
  onQuit: () => void
}

/** Shown when the pointer is released in game. */
export function PauseMenu({ file, layers, onToggle, onResume, onQuit }: PauseMenuProps) {
  // every click except "Reprendre" stays here; that one reaches the pointer-lock controls (document listener)
  const onClick = (e: React.MouseEvent) => { if (!(e.target as HTMLElement).closest('[data-resume]')) e.stopPropagation() }
  return (
    <div className="ui-root pause" onClick={onClick}>
      <div className="pause-col">
        <div className="pause-title caps">{mapDisplayName(file)}</div>
        <div className="pause-sub">{mapPlace(file)}</div>
        <button className="pause-item caps" data-resume onClick={onResume}>Reprendre</button>
        <button className="pause-item caps" onClick={onQuit}>Changer de map</button>

        <div className="pause-section caps mono">Affichage</div>
        {LAYER_LABELS.map(([k, label, key]) => (
          <button key={k} className="pause-toggle" onClick={() => onToggle(k)}>
            <span>{label} <span className="mono" style={{ color: 'var(--dim)', fontSize: 11 }}>{key}</span></span>
            <span className={`state ${layers[k] ? 'on' : ''}`}>{layers[k] ? 'ACTIVÉ' : 'DÉSACTIVÉ'}</span>
          </button>
        ))}

      </div>
      <div className="pause-col pause-help">
        <div className="pause-section caps mono">Commandes</div>
        <div className="pause-keys">{KEYS.map(([k, v]) => [<kbd key={k}>{k}</kbd>, <span key={`${k}-v`}>{v}</span>])}</div>
      </div>
    </div>
  )
}
