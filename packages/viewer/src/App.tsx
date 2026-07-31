import { useCallback, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Box } from '@react-three/drei'
import { Physics } from '@react-three/rapier'
import FolderSelector from './components/FolderSelector'
import { FPSCamera } from './components/FPSCamera'
import type { MapInfo } from './types'

async function scanDir(
  dir: FileSystemDirectoryHandle,
  predicate: (name: string) => boolean,
): Promise<string[]> {
  const results: string[] = []
  for await (const entry of dir.values()) {
    if (entry.kind === 'file' && predicate(entry.name)) {
      results.push(entry.name)
    }
  }
  return results
}

async function detectMW3Paths(folderHandle: FileSystemDirectoryHandle): Promise<MapInfo> {
  const foundFFs: string[] = []
  const foundIWDs: string[] = []

  // 1) Chercher dans le dossier racine (cas : inputs/mp_seatown/)
  const rootFFs = await scanDir(folderHandle, (n) => n.endsWith('.ff'))
  const rootIWDs = await scanDir(folderHandle, (n) => n.endsWith('.iwd'))
  foundFFs.push(...rootFFs)
  foundIWDs.push(...rootIWDs)

  // 2) Chercher dans zone/ (cas : installation MW3 standard)
  try {
    const zoneDir = await folderHandle.getDirectoryHandle('zone', { create: false })
    const zoneFFs = await scanDir(zoneDir, (n) => n.endsWith('.ff'))
    foundFFs.push(...zoneFFs)
  } catch {
    console.warn('zone/ introuvable')
  }

  // 3) Chercher dans main/ (cas : installation MW3 standard)
  try {
    const mainDir = await folderHandle.getDirectoryHandle('main', { create: false })
    const mainIWDs = await scanDir(mainDir, (n) => n.endsWith('.iwd'))
    foundIWDs.push(...mainIWDs)
  } catch {
    console.warn('main/ introuvable')
  }

  return { maps: [...new Set(foundFFs)], archives: [...new Set(foundIWDs)], path: folderHandle.name }
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
