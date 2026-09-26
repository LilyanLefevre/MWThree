import { useImage, type ImageSource } from '../menuImages'
import { loadscreenNames, mapDisplayName, mapPlace } from '../mapNames'

/** The map's own loading screen (loadscreen_mp_<map>), its name and place, and the loading progress. */
export function LoadingScreen({ file, images, stage, progress }: { file: string; images: ImageSource | null; stage: string; progress: number }) {
  const art = useImage(images, ...loadscreenNames(file))
  return (
    <div className="ui-root loading">
      <div className="ui-backdrop loading" style={art ? { backgroundImage: `url(${art})` } : undefined} />
      <div className="loading-band">
        <div>
          <div className="loading-name caps">{mapDisplayName(file)}</div>
          {mapPlace(file) && <div className="loading-place">{mapPlace(file)}</div>}
        </div>
        <div className="loading-status mono">
          <span className="pct">{Math.round(progress * 100)} %</span>
          {stage}
        </div>
      </div>
      <div className="loading-bar"><div style={{ width: `${Math.max(2, progress * 100)}%` }} /></div>
    </div>
  )
}
