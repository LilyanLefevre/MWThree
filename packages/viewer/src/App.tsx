import { useCallback, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Box } from '@react-three/drei'
import { Physics } from '@react-three/rapier'
import FolderSelector from './components/FolderSelector'
import { FPSCamera } from './components/FPSCamera'
import type { MapInfo, LoadResult } from './types'

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
  const foundFFs = new Set<string>()
  const foundIWDs = new Set<string>()

  // Racine
  for (const name of await scanDir(folderHandle, (n) => n.endsWith('.ff')))
    foundFFs.add(name)
  for (const name of await scanDir(folderHandle, (n) => n.endsWith('.iwd')))
    foundIWDs.add(name)

  // zone/ (ou zone/*/)
  async function scanZone(path: FileSystemDirectoryHandle) {
    for await (const entry of path.values()) {
      if (entry.kind === 'file' && entry.name.endsWith('.ff')) {
        foundFFs.add(entry.name)
      }
      if (entry.kind === 'directory') {
        try {
          const sub = await path.getDirectoryHandle(entry.name)
          for (const name of await scanDir(sub, (n) => n.endsWith('.ff')))
            foundFFs.add(name)
        } catch { /* skip */ }
      }
    }
  }
  try {
    await scanZone(await folderHandle.getDirectoryHandle('zone'))
  } catch { /* no zone/ */ }

  // main/
  try {
    const mainDir = await folderHandle.getDirectoryHandle('main')
    for (const name of await scanDir(mainDir, (n) => n.endsWith('.iwd')))
      foundIWDs.add(name)
  } catch { /* no main/ */ }

  return {
    maps: [...foundFFs].sort(),
    archives: [...foundIWDs].sort(),
    path: folderHandle.name,
  }
}

async function findAndLoadFF(
  folderHandle: FileSystemDirectoryHandle,
  fileName: string,
): Promise<LoadResult> {
  async function findFile(dir: FileSystemDirectoryHandle): Promise<ArrayBuffer | null> {
    try {
      const fileHandle = await dir.getFileHandle(fileName)
      const file = await fileHandle.getFile()
      return file.arrayBuffer()
    } catch { return null }
  }

  let buffer = await findFile(folderHandle)
  if (!buffer) {
    try {
      const zoneDir = await folderHandle.getDirectoryHandle('zone')
      buffer = await findFile(zoneDir)
      if (!buffer) {
        for await (const entry of zoneDir.values()) {
          if (entry.kind === 'directory') {
            const sub = await zoneDir.getDirectoryHandle(entry.name)
            buffer = await findFile(sub)
            if (buffer) break
          }
        }
      }
    } catch { /* not found */ }
  }

  if (!buffer) {
    return { fileName, compressedBytes: 0, decompressedBytes: 0, success: false, error: 'Fichier introuvable' }
  }

  try {
    const { FastFileLoader, ZoneParser, SUPPORTED_ASSET_TYPES } = await import('@mwthree/iw5-core')
    const loader = new FastFileLoader(buffer)
    const zone = loader.load()

    const parser = new ZoneParser(zone)
    const info = parser.parse()
    const zoneName = parser.findZoneName()

    const assetCounts = new Map<number, number>()
    for (const a of info.assets) {
      if (!a.isNull) {
        assetCounts.set(a.type, (assetCounts.get(a.type) ?? 0) + 1)
      }
    }
    const assets = [...assetCounts.entries()]
      .map(([type, count]) => ({
        type,
        typeName: SUPPORTED_ASSET_TYPES[type] ?? `UNKNOWN_${type}`,
        count,
      }))
      .sort((a, b) => b.count - a.count)

    return {
      fileName,
      compressedBytes: buffer.byteLength,
      decompressedBytes: zone.byteLength,
      success: true,
      zoneName,
      xfileSize: info.header.size,
      blocks: Object.entries(info.header.blocks)
        .filter(([, s]) => s > 0)
        .map(([name, size]) => ({ name, size })),
      stringCount: info.stringCount,
      assetCount: info.assetCount,
      assets,
    }
  } catch (err: any) {
    return {
      fileName,
      compressedBytes: buffer.byteLength,
      decompressedBytes: 0,
      success: false,
      error: err.message,
    }
  }
}

function App() {
  const [folderHandle, setFolderHandle] = useState<FileSystemDirectoryHandle | null>(null)
  const [mapInfo, setMapInfo] = useState<MapInfo | null>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const [result, setResult] = useState<LoadResult | null>(null)

  const handleFolderSelected = useCallback(async (fh: FileSystemDirectoryHandle) => {
    setFolderHandle(fh)
    setResult(null)
    const info = await detectMW3Paths(fh)
    setMapInfo(info)
  }, [])

  const handleLoadMap = useCallback(async (name: string) => {
    if (!folderHandle) return
    setLoading(name)
    setResult(null)
    const r = await findAndLoadFF(folderHandle, name)
    setResult(r)
    setLoading(null)
  }, [folderHandle])

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden' }}>
      <Canvas camera={{ position: [0, 3, 5], fov: 75 }} style={{ width: '100%', height: '100%' }}>
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

      <FolderSelector onFolderSelected={handleFolderSelected} />

      <div style={{
        position: 'absolute', top: 50, right: 10, zIndex: 100,
        background: 'rgba(0,0,0,0.75)', color: 'white',
        padding: 10, borderRadius: 5,
        fontFamily: 'monospace', fontSize: 12,
        maxHeight: '80vh', overflowY: 'auto', minWidth: 220,
      }}>
        {result && (
          <>
            {result.success ? (
              <div style={{ color: '#6f6' }}>
                ✓ {result.fileName}
              </div>
            ) : (
              <div style={{ color: '#f66' }}>
                ✗ {result.fileName}<br />
                {result.error}
              </div>
            )}
            <div style={{ fontSize: 11, marginTop: 4 }}>
              FF: {(result.compressedBytes / 1024 / 1024).toFixed(1)} MB → Zone: {(result.decompressedBytes / 1024 / 1024).toFixed(1)} MB
            </div>
            {result.zoneName && (
              <div style={{ fontSize: 11, color: '#ff6' }}>Zone: {result.zoneName}</div>
            )}
            {result.blocks && result.blocks.length > 0 && (
              <div style={{ fontSize: 10, marginTop: 4 }}>
                <div style={{ color: '#8af', fontWeight: 'bold' }}>XFile blocks</div>
                {result.blocks.map((b) => (
                  <div key={b.name}>
                    {b.name}: {(b.size / 1024 / 1024).toFixed(1)} MB
                  </div>
                ))}
              </div>
            )}
            {result.assets && result.assets.length > 0 && (
              <div style={{ fontSize: 10, marginTop: 4 }}>
                <div style={{ color: '#8af', fontWeight: 'bold' }}>
                  Assets: {result.assetCount} ({result.stringCount} strings)
                </div>
                {result.assets.map((a) => (
                  <div key={a.type}>
                    [{a.type}] {a.typeName}: {a.count}
                  </div>
                ))}
              </div>
            )}
            <hr style={{ borderColor: '#555', margin: '6px 0' }} />
          </>
        )}
        {loading && <div style={{ color: '#88f' }}>Chargement de {loading}...</div>}
        {mapInfo && (
          <>
            <div style={{ fontWeight: 'bold', marginBottom: 4 }}>{mapInfo.path}</div>
            <div>Maps: {mapInfo.maps.length} &bull; Archives: {mapInfo.archives.length}</div>
            <hr style={{ borderColor: '#555', margin: '6px 0' }} />
            {mapInfo.maps.length === 0 && <div style={{ color: '#ff6' }}>Aucune map trouvée</div>}
            {mapInfo.maps.map((m) => (
              <div
                key={m}
                onClick={() => handleLoadMap(m)}
                style={{
                  cursor: 'pointer', padding: '2px 4px',
                  background: loading === m ? '#555' : 'transparent',
                  borderRadius: 3,
                }}
              >
                {m}
              </div>
            ))}
          </>
        )}
      </div>

      <div style={{
        position: 'absolute', bottom: 10, left: '50%', transform: 'translateX(-50%)',
        background: 'rgba(0,0,0,0.5)', color: 'white',
        padding: '4px 12px', borderRadius: 5, zIndex: 100,
        fontFamily: 'monospace', fontSize: 11, pointerEvents: 'none',
      }}>
        Clique sur le canvas pour le mode FPS &bull; WASD + Souris + ESPACE
      </div>
    </div>
  )
}

export default App
