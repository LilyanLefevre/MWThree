import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import * as THREE from 'three'
import { Physics } from '@react-three/rapier'
import FolderSelector from './components/FolderSelector'
import { WorldMesh } from './components/WorldMesh'
import { Player } from './components/Player'
import { StaticModels } from './components/StaticModels'
import { Sky } from './components/Sky'
import { UNIT_SCALE } from '@mwthree/iw5-core'
import type { MapInfo, MapWorld } from './types'
import type { IwdSource, MapResponse, SpawnPoint } from './worker/protocol'
import { SpawnMarkers } from './components/SpawnMarkers'
import { Minimap } from './components/Minimap'
import { Objectives } from './components/Objectives'
import { mapDisplayName } from './mapNames'

/** `values()` is missing from the DOM typings of the File System Access API. */
const entries = (dir: FileSystemDirectoryHandle) => (dir as unknown as { values(): AsyncIterable<FileSystemHandle> }).values()

const MAP_FF = /^mp_[a-z0-9_]+\.ff$/i
const isMapFile = (n: string) => MAP_FF.test(n) && !/_load\.ff$/i.test(n)

async function listFiles(dir: FileSystemDirectoryHandle, predicate: (name: string) => boolean): Promise<string[]> {
  const out: string[] = []
  for await (const entry of entries(dir)) if (entry.kind === 'file' && predicate(entry.name)) out.push(entry.name)
  return out
}

async function detectMW3Paths(root: FileSystemDirectoryHandle): Promise<MapInfo> {
  const maps = new Set<string>()
  const archives = new Set<string>()
  for (const n of await listFiles(root, isMapFile)) maps.add(n)
  for (const n of await listFiles(root, n => n.endsWith('.iwd'))) archives.add(n)
  try {
    const zone = await root.getDirectoryHandle('zone')
    for (const n of await listFiles(zone, isMapFile)) maps.add(n)
    for await (const entry of entries(zone)) {
      if (entry.kind !== 'directory') continue
      const sub = await zone.getDirectoryHandle(entry.name)
      for (const n of await listFiles(sub, isMapFile)) maps.add(n)
    }
  } catch { /* no zone/ */ }
  try {
    const main = await root.getDirectoryHandle('main')
    for (const n of await listFiles(main, n => n.endsWith('.iwd'))) archives.add(n)
  } catch { /* no main/ */ }
  return { maps: [...maps].sort(), archives: [...archives].sort(), path: root.name }
}

async function readMapFile(root: FileSystemDirectoryHandle, fileName: string): Promise<ArrayBuffer> {
  const tryDir = async (dir: FileSystemDirectoryHandle) => {
    try { return await (await (await dir.getFileHandle(fileName)).getFile()).arrayBuffer() } catch { return null }
  }
  let buf = await tryDir(root)
  if (buf) return buf
  const zone = await root.getDirectoryHandle('zone')
  buf = await tryDir(zone)
  if (buf) return buf
  for await (const entry of entries(zone)) {
    if (entry.kind !== 'directory') continue
    buf = await tryDir(await zone.getDirectoryHandle(entry.name))
    if (buf) return buf
  }
  throw new Error(`${fileName} introuvable`)
}

/** The .iwd archives of the installation (root and main/), as local files. */
async function listIwd(root: FileSystemDirectoryHandle): Promise<IwdSource[]> {
  const out: IwdSource[] = []
  const collect = async (dir: FileSystemDirectoryHandle) => {
    for await (const entry of entries(dir)) {
      if (entry.kind === 'file' && entry.name.endsWith('.iwd')) out.push({ file: await (entry as FileSystemFileHandle).getFile() })
    }
  }
  await collect(root)
  try { await collect(await root.getDirectoryHandle('main')) } catch { /* no main/ */ }
  return out
}

const wrap = (i: number, n: number) => (n ? ((i % n) + n) % n : 0)

/** Spawns the player can teleport between: deathmatch spawns, else every spawn. */
function teleportSpawns(world: MapWorld): SpawnPoint[] {
  const dm = world.spawns.filter(p => p.classname === 'mp_dm_spawn')
  return dm.length ? dm : world.spawns
}

/** Spawn point -> scene position (meters, Y-up) and camera yaw. */
function spawnPose(s: SpawnPoint | undefined): { pos: [number, number, number]; yaw: number } {
  if (!s) return { pos: [0, 3, 0], yaw: 0 }
  const [x, y, z] = s.origin
  // game yaw (CCW from +X, Z-up) -> three.js camera yaw about +Y (camera looks down -Z)
  const yaw = (s.angles[1] * Math.PI) / 180 - Math.PI / 2
  return { pos: [x * UNIT_SCALE, z * UNIT_SCALE + 0.3, -y * UNIT_SCALE], yaw }
}

function App() {
  const [folder, setFolder] = useState<FileSystemDirectoryHandle | null>(null)
  const [mapInfo, setMapInfo] = useState<MapInfo | null>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const [stage, setStage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [world, setWorld] = useState<MapWorld | null>(null)
  const [fly, setFly] = useState(false)
  const [showCollision, setShowCollision] = useState(false)
  const [showSpawns, setShowSpawns] = useState(false)
  const [showObjectives, setShowObjectives] = useState(true)
  const [spawnIndex, setSpawnIndex] = useState(0)
  const [texturing, setTexturing] = useState(false)
  const worker = useRef<Worker | null>(null)

  const runWorker = useCallback((buffer: ArrayBuffer, fileName: string, iwd: IwdSource[]) => {
    worker.current?.terminate()
    const w = new Worker(new URL('./worker/mapWorker.ts', import.meta.url), { type: 'module' })
    worker.current = w
    setLoading(fileName); setError(null); setStage('Démarrage')
    w.onmessage = (e: MessageEvent<MapResponse>) => {
      const m = e.data
      if (m.type === 'progress') setStage(m.stage)
      else if (m.type === 'error') { setError(m.message); setLoading(null); w.terminate() }
      else if (m.type === 'textures') {
        setWorld(prev => prev && { ...prev, textures: m.textures, materialImages: m.materialImages, materialNormals: m.materialNormals, sky: m.sky, stats: { ...prev.stats, textures: m.textures.length } })
        setStage(''); setTexturing(false); w.terminate()
      } else {
        setWorld({ ...m, materialImages: {}, materialNormals: {}, textures: [], sky: null }); setLoading(null)
        setTexturing(iwd.length > 0)
        if (iwd.length === 0) w.terminate()
        ;(window as unknown as { __mapStats?: unknown }).__mapStats = m.stats
      }
    }
    w.onerror = ev => { setError(ev.message); setLoading(null) }
    w.postMessage({ buffer, fileName, iwd }, [buffer])
  }, [])

  const onFolder = useCallback(async (fh: FileSystemDirectoryHandle) => {
    setFolder(fh)
    setMapInfo(await detectMW3Paths(fh))
  }, [])

  const loadMap = useCallback(async (name: string) => {
    if (!folder) return
    try { runWorker(await readMapFile(folder, name), name, await listIwd(folder)) } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }, [folder, runWorker])

  // dev helper: /?dev=dome loads inputs/zone/dome/mp_dome.ff served by the Vite dev server
  useEffect(() => {
    const dev = new URLSearchParams(location.search).get('dev')
    if (!dev || !import.meta.env.DEV) return
    const name = `mp_${dev}.ff`
    setLoading(name); setStage('Téléchargement (dev)')
    Promise.all([
      fetch(`/__inputs/zone/${dev}/${name}`).then(r => r.arrayBuffer()),
      fetch('/__inputs-list/main').then(r => r.json() as Promise<string[]>).catch(() => [] as string[]),
    ]).then(([b, iwds]) => runWorker(b, name, iwds.map(n => ({ url: `/__inputs/main/${n}` })))).catch(e => setError(String(e)))
  }, [runWorker])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return
      if (e.code === 'KeyC') setShowCollision(v => !v)
      if (e.code === 'KeyO') setShowSpawns(v => !v)
      if (e.code === 'KeyB') setShowObjectives(v => !v)
      if (e.code === 'KeyT') setSpawnIndex(i => i + (e.shiftKey ? -1 : 1))
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const spawnList = useMemo(() => (world ? teleportSpawns(world) : []), [world])
  useEffect(() => setSpawnIndex(0), [world?.fileName])
  const spawn = useMemo(() => (world ? spawnPose(spawnList[wrap(spawnIndex, spawnList.length)]) : null), [world, spawnList, spawnIndex])
  const isLoading = loading !== null

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden', background: '#0b0d10' }}>
      <Canvas camera={{ position: [0, 3, 5], fov: 75, near: 0.05, far: 6000 }} style={{ width: '100%', height: '100%' }}>
        <color attach="background" args={['#9fb4c7']} />
        {world?.sky && <Sky sky={world.sky} />}
        <fog attach="fog" args={['#9fb4c7', 300, 2500]} />
        <hemisphereLight args={['#cfdcee', '#7a6a55', 0.9]} />
        <directionalLight
          position={world?.sun ? world.sun.direction.map(v => v * 500) as [number, number, number] : [300, 500, 200]}
          color={world?.sun ? new THREE.Color(...world.sun.color.map(c => Math.min(1, c / Math.max(...world.sun!.color, 1)))) : '#ffffff'}
          intensity={1.5}
        />
        {world && spawn && (
          <Physics gravity={[0, -20, 0]}>
            <WorldMesh world={world} showCollision={showCollision} />
            <StaticModels world={world} />
            {showSpawns && <SpawnMarkers spawns={world.spawns} />}
            {showObjectives && <Objectives objectives={world.objectives} />}
            <Player spawn={spawn.pos} yaw={spawn.yaw} onFly={setFly} />
          </Physics>
        )}
      </Canvas>

      <FolderSelector onFolderSelected={onFolder} />
      {world && <Minimap world={world} />}

      <div style={{
        position: 'absolute', top: 10, right: 10, zIndex: 100, background: 'rgba(0,0,0,0.75)', color: 'white',
        padding: 10, borderRadius: 5, fontFamily: 'monospace', fontSize: 12, maxHeight: '85vh', overflowY: 'auto', minWidth: 240,
      }}>
        {isLoading && <div style={{ color: '#8af' }}>⏳ {loading}<br />{stage}…</div>}
        {texturing && !isLoading && <div style={{ color: '#8af' }}>🖼 {stage || 'Textures'}…</div>}
        {error && <div style={{ color: '#f77' }}>✗ {error}</div>}
        {world && !isLoading && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ color: '#6f6' }}>✓ {mapDisplayName(world.fileName)} <span style={{ color: '#888' }}>({world.fileName})</span></div>
            <div>{(world.indices.length / 3).toLocaleString()} triangles · {world.stats.surfaces.toLocaleString()} surfaces</div>
            <div>{world.stats.entities.toLocaleString()} entités · {world.spawns.length} spawns</div>
            <div>{world.stats.staticInstances.toLocaleString()} props ({world.stats.staticModels} modèles){world.textures.length > 0 && ` · ${world.textures.filter(t => !t.normal).length} textures`}</div>
            <div>dont {world.stats.entityProps} issus d'entités ({world.stats.missingEntityModels} modèles absents)</div>
            <div style={{ color: '#aaa' }}>
              {world.stats.fromCache
                ? `chargé depuis le cache en ${world.stats.msTotal} ms`
                : `décompression ${world.stats.msDecompress} ms · lecture ${world.stats.msParse} ms`}
            </div>
            <div>{world.collision ? `collision : ${world.collision.brushes.toLocaleString()} brushes + ${world.collision.models.toLocaleString()} props (C = afficher)` : 'collision : mesh visible'}</div>
            <div>spawn {spawnList.length ? wrap(spawnIndex, spawnList.length) + 1 : 0}/{spawnList.length} (T / Maj+T) · O = repères · B = objectifs ({world.objectives.length})</div>
            <div style={{ color: '#ff6' }}>{fly ? 'Mode vol (V pour revenir)' : 'Marche (V = vol libre)'}</div>
          </div>
        )}
        {mapInfo && (
          <>
            <div style={{ fontWeight: 'bold' }}>{mapInfo.path}</div>
            <div>Maps: {mapInfo.maps.length} · Archives: {mapInfo.archives.length}</div>
            <hr style={{ borderColor: '#555', margin: '6px 0' }} />
            {mapInfo.maps.map(m => (
              <div key={m} onClick={() => !isLoading && loadMap(m)}
                style={{ cursor: isLoading ? 'wait' : 'pointer', padding: '2px 4px', background: loading === m ? '#555' : 'transparent', borderRadius: 3 }}>
                {mapDisplayName(m)} <span style={{ color: '#888' }}>{m}</span>
              </div>
            ))}
          </>
        )}
      </div>

      <div style={{
        position: 'absolute', bottom: 10, left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.5)', color: 'white',
        padding: '4px 12px', borderRadius: 5, zIndex: 100, fontFamily: 'monospace', fontSize: 11, pointerEvents: 'none',
      }}>
        Clique sur le canvas pour capturer la souris · WASD/ZQSD · Espace · Maj · V = vol libre · C = collision · T = spawn suivant · O = repères · B = objectifs
      </div>
    </div>
  )
}

export default App
