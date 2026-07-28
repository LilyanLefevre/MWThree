import { useCallback, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Box } from '@react-three/drei'
import { Physics } from '@react-three/rapier'
import FolderSelector from './components/FolderSelector'
import { FPSCamera } from './components/FPSCamera'
import type { MapInfo } from './types'

function detectMW3Paths(folderHandle: FileSystemDirectoryHandle): Promise<MapInfo> {
  return (async () => {
    const foundFFs: string[] = []
    const foundIWDs: string[] = []

    try {
      const zoneDir = await folderHandle.getDirectoryHandle('zone', { create: false })
      for await (const entry of zoneDir.values()) {
        if (entry.kind === 'file' && entry.name.startsWith('mp_') && entry.name.endsWith('.ff')) {
          foundFFs.push(entry.name)
        }
      }
    } catch {
      console.warn('zone/ introuvable')
    }

    try {
      const mainDir = await folderHandle.getDirectoryHandle('main', { create: false })
      for await (const entry of mainDir.values()) {
        if (entry.kind === 'file' && entry.name.endsWith('.iwd')) {
          foundIWDs.push(entry.name)
        }
      }
    } catch {
      console.warn('main/ introuvable')
    }

    return { maps: foundFFs, archives: foundIWDs, path: folderHandle.name }
  })()
}

function App() {
  const [mapInfo, setMapInfo] = useState<MapInfo | null>(null)

  const handleFolderSelected = useCallback(async (folderHandle: FileSystemDirectoryHandle) => {
    const info = await detectMW3Paths(folderHandle)
    setMapInfo(info)
    console.log('MW3 installation:', info)
  }, [])

  return (
    <>
      <FolderSelector onFolderSelected={handleFolderSelected} />
      {mapInfo && (
        <div style={{
          position: 'absolute', top: 10, right: 10,
          background: 'rgba(0,0,0,0.7)', color: 'white',
          padding: 8, borderRadius: 5, zIndex: 100,
          fontFamily: 'monospace', fontSize: 12
        }}>
          <div>Dossier: {mapInfo.path}</div>
          <div>Maps trouvées: {mapInfo.maps.length}</div>
          <div>Archives: {mapInfo.archives.length}</div>
        </div>
      )}
      <div style={{
        position: 'absolute', bottom: 10, left: '50%', transform: 'translateX(-50%)',
        background: 'rgba(0,0,0,0.5)', color: 'white',
        padding: '4px 12px', borderRadius: 5, zIndex: 100,
        fontFamily: 'monospace', fontSize: 11
      }}>
        Clique sur le canvas pour activer le mode FPS &bull; WASD + Souris + ESPACE
      </div>

      <Canvas camera={{ position: [0, 3, 5], fov: 75 }}>
        <ambientLight intensity={0.5} />
        <pointLight position={[10, 10, 10]} />
        <Physics gravity={[0, -9.81, 0]}>
          <Box args={[1, 1, 1]} position={[0, 0.5, 0]}>
            <meshStandardMaterial color="hotpink" />
          </Box>
          <Box args={[20, 0.1, 20]} position={[0, -0.05, 0]}>
            <meshStandardMaterial color="lightgray" />
          </Box>
          <FPSCamera />
        </Physics>
      </Canvas>
    </>
  )
}

export default App
