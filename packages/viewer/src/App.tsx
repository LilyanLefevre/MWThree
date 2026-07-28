import React, { useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Box } from '@react-three/drei'
import { Physics } from '@react-three/rapier'
import FolderSelector from './components/FolderSelector'

function App() {
  const [gameFolder, setGameFolder] = useState<FileSystemDirectoryHandle | null>(null)

  const detectMW3Paths = async (folderHandle: FileSystemDirectoryHandle) => {
    console.log('Detecting MW3 paths...')
    const foundFFs: string[] = []
    const foundIWDs: string[] = []

    try {
      const zoneDir = await folderHandle.getDirectoryHandle('zone', { create: false })
      if (zoneDir) {
        for await (const entry of zoneDir.values()) {
          if (entry.kind === 'file' && entry.name.startsWith('mp_') && entry.name.endsWith('.ff')) {
            foundFFs.push(entry.name)
          }
        }
      }
    } catch (error) {
      // zone directory not found or inaccessible
      console.warn('Zone directory not found or accessible', error)
    }

    try {
      const mainDir = await folderHandle.getDirectoryHandle('main', { create: false })
      if (mainDir) {
        for await (const entry of mainDir.values()) {
          if (entry.kind === 'file' && entry.name.endsWith('.iwd')) {
            foundIWDs.push(entry.name)
          }
        }
      }
    } catch (error) {
      // main directory not found or inaccessible
      console.warn('Main directory not found or accessible', error)
    }

    console.log('Found FFs:', foundFFs)
    console.log('Found IWDs:', foundIWDs)
    if (foundFFs.length > 0 && foundIWDs.length > 0) {
      console.log('MW3 installation detected!')
    } else {
      console.log('MW3 installation not fully detected. Missing FFs or IWDs.')
    }
  }

  const handleFolderSelected = async (folderHandle: FileSystemDirectoryHandle) => {
    setGameFolder(folderHandle)
    console.log('Game folder selected:', folderHandle.name)
    await detectMW3Paths(folderHandle)
  }

  return (
    <>
      <FolderSelector onFolderSelected={handleFolderSelected} />
      <Canvas camera={{ position: [0, 2, 5], fov: 75 }}>
        <ambientLight intensity={0.5} />
        <pointLight position={[10, 10, 10]} />
        <Physics>
          <Box args={[1, 1, 1]} position={[0, 0.5, 0]}>
            <meshStandardMaterial color="hotpink" />
          </Box>
          <Box args={[10, 0.1, 10]} position={[0, -0.05, 0]}>
            <meshStandardMaterial color="lightgray" />
          </Box>
        </Physics>
        <OrbitControls />
      </Canvas>
    </>
  )
}

export default App
