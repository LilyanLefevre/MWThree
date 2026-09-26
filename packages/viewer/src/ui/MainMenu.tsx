import { useEffect, useState } from 'react'
import { useImage, type ImageSource } from '../menuImages'
import { mapCode, mapDisplayName, mapPlace, loadscreenNames, previewNames } from '../mapNames'

export type MapSource = 'server' | 'local'

function MapCard({ file, images, onPick, onHover }: { file: string; images: ImageSource | null; onPick: () => void; onHover: () => void }) {
  const code = mapCode(file)
  const thumb = useImage(images, ...previewNames(file))
  return (
    <button className="map-card" onClick={onPick} onMouseEnter={onHover} onFocus={onHover}>
      {thumb && <img src={thumb} alt="" />}
      <span className="label">
        <span className="name caps">{mapDisplayName(file)}</span>
        <span className="code mono">{code}</span>
      </span>
    </button>
  )
}

export interface MainMenuProps {
  /** maps shared by the server (null: this build has no server, e.g. static hosting) */
  serverMaps: string[] | null
  serverImages: ImageSource | null
  /** the player's own MW3 folder, once picked */
  local: { name: string; maps: string[] } | null
  localImages: ImageSource | null
  onPickFolder: () => void
  onLoad: (source: MapSource, file: string) => void
  error: string | null
}

const FOLDER_PICKER = typeof window !== 'undefined' && 'showDirectoryPicker' in window

export function MainMenu({ serverMaps, serverImages, local, localImages, onPickFolder, onLoad, error }: MainMenuProps) {
  const [tab, setTab] = useState<MapSource>(serverMaps?.length ? 'server' : 'local')
  useEffect(() => { if (serverMaps?.length && !local) setTab('server') }, [serverMaps, local])
  const maps = tab === 'server' ? serverMaps ?? [] : local?.maps ?? []
  const images = tab === 'server' ? serverImages : localImages
  const [featured, setFeatured] = useState<string | null>(null)
  const shown = featured && maps.includes(featured) ? featured : maps[0] ?? null
  const backdrop = useImage(images, ...(shown ? loadscreenNames(shown) : []))

  return (
    <div className="ui-root">
      <div className="ui-backdrop menu" style={backdrop ? { backgroundImage: `url(${backdrop})` } : undefined} />
      <div className="menu">
        <div className="menu-main">
          <div className="brand caps">MW<span>Three</span></div>
          <div className="tagline mono">Explorateur Modern Warfare 3 (2011) · à partir de vos fichiers du jeu</div>

          <div className="tabs caps" role="tablist">
            {serverMaps !== null && (
              <button className="tab caps" role="tab" aria-selected={tab === 'server'} onClick={() => setTab('server')}>
                Serveur<small>{serverMaps.length}</small>
              </button>
            )}
            <button className="tab caps" role="tab" aria-selected={tab === 'local'} onClick={() => setTab('local')}>
              Mes fichiers{local && <small>{local.maps.length}</small>}
            </button>
          </div>

          {error && <div className="menu-error">{error}</div>}

          {tab === 'local' && !local && (
            <div className="empty">
              <p>Choisissez le dossier d'installation de Modern Warfare 3 (ou un dossier contenant <span className="mono">zone/&lt;map&gt;/mp_&lt;map&gt;.ff</span> et <span className="mono">main/*.iwd</span>). Les fichiers restent sur votre machine.</p>
              {FOLDER_PICKER
                ? <button className="btn caps" onClick={onPickFolder}>Choisir le dossier du jeu</button>
                : <p className="mono">Ce navigateur ne permet pas d'ouvrir un dossier (File System Access API) : utilisez Chrome ou Edge.</p>}
            </div>
          )}
          {tab === 'server' && serverMaps?.length === 0 && (
            <div className="empty">Le serveur ne partage aucune map. Ajoutez des fichiers dans <span className="mono">inputs/zone/&lt;map&gt;/mp_&lt;map&gt;.ff</span> sur la machine qui l'héberge.</div>
          )}

          {maps.length > 0 && (
            <div className="map-grid">
              {maps.map(f => <MapCard key={`${tab}:${f}`} file={f} images={images} onPick={() => onLoad(tab, f)} onHover={() => setFeatured(f)} />)}
            </div>
          )}

          <div className="menu-foot mono">
            {tab === 'local' && local && <button className="btn ghost caps" onClick={onPickFolder}>Changer de dossier</button>}
            <span>{tab === 'local' && local ? `Dossier : ${local.name || 'sélectionné'}` : 'Les fichiers du jeu ne sont jamais publiés'}</span>
          </div>
        </div>

        {shown && (
          <div className="menu-feature">
            <div className="name caps">{mapDisplayName(shown)}</div>
            <div className="place">{mapPlace(shown)}</div>
          </div>
        )}
      </div>
    </div>
  )
}
