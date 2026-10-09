import { Minimap } from '../components/Minimap'
import { mapDisplayName } from '../mapNames'
import type { MapWorld } from '../types'

export interface Layers { collision: boolean; spawns: boolean; objectives: boolean; triggers: boolean }

export interface HudProps {
  world: MapWorld
  fly: boolean
  spawn: { index: number; count: number }
  /** texture streaming status, empty when done */
  texturing: string
  layers: Layers
  /** technical panel (I) */
  debug: boolean
}

/** In-game overlay: minimap, crosshair, map and mode, key hints; the technical panel on demand. */
export function Hud({ world, fly, spawn, texturing, layers, debug }: HudProps) {
  const s = world.stats
  return (
    <div className="hud">
      <div className="hud-minimap"><Minimap world={world} /></div>
      <div className="hud-crosshair"><i /><i /><i /><i /></div>
      {texturing && <div className="hud-texturing mono">{texturing}…</div>}

      <div className="hud-map">
        <div className="name caps">{mapDisplayName(world.fileName)}</div>
        <div className="meta mono">
          <span className="mode">{fly ? 'VOL LIBRE' : 'MARCHE'}</span> · spawn {spawn.index + 1}/{spawn.count}
        </div>
      </div>

      <div className="hud-keys caps">
        <span><kbd>T</kbd>Spawn</span>
        <span><kbd>V</kbd>Vol</span>
        <span><kbd>B</kbd>Objectifs</span>
        <span><kbd>Échap</kbd>Menu</span>
      </div>

      {debug && (
        <div className="hud-debug">
          <div>{world.fileName}</div>
          <div>{(world.indices.length / 3).toLocaleString()} triangles · {s.surfaces.toLocaleString()} surfaces</div>
          <div>{s.entities.toLocaleString()} entités · {world.spawns.length} spawns</div>
          <div>{s.staticInstances.toLocaleString()} props ({s.staticModels} modèles){world.textures.length > 0 && ` · ${world.textures.filter(t => !t.normal).length} textures`}</div>
          <div>dont {s.entityProps} issus d'entités ({s.missingEntityModels} modèles absents)</div>
          <div style={{ color: 'var(--muted)' }}>
            {s.fromCache
              ? `chargé depuis le cache en ${s.msTotal} ms`
              : `décompression ${s.msDecompress} ms · lecture ${s.msParse} ms${s.msTextures ? ` · textures ${s.msTextures} ms` : ''}`}
          </div>
          <div>{world.collision ? `collision : ${world.collision.brushes.toLocaleString()} brushes` : 'collision : mesh visible'}</div>
          <div style={{ color: 'var(--muted)' }}>
            {(['collision', 'spawns', 'objectives', 'triggers'] as const).map(k => `${layers[k] ? '●' : '○'} ${k}`).join('  ')}
          </div>
        </div>
      )}
    </div>
  )
}
