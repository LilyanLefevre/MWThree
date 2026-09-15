import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import * as THREE from 'three'
import { Physics } from '@react-three/rapier'
import { WorldMesh } from './components/WorldMesh'
import { Player } from './components/Player'
import { StaticModels } from './components/StaticModels'
import { Sky } from './components/Sky'
import { setFog } from './components/materials'
import { UNIT_SCALE } from '@mwthree/iw5-core'
import type { MapInfo, MapWorld } from './types'
import type { IwdSource, MapResponse, SpawnPoint } from './worker/protocol'
import { SpawnMarkers } from './components/SpawnMarkers'
import { Objectives } from './components/Objectives'
import { RenderStats } from './components/RenderStats'
import { Triggers } from './components/Triggers'
import { createImageSource, type ImageSource } from './menuImages'
import { MainMenu, type MapSource } from './ui/MainMenu'
import { LoadingScreen } from './ui/LoadingScreen'
import { Hud, type Layers } from './ui/Hud'
import { PauseMenu } from './ui/PauseMenu'
import './ui/ui.css'

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

/** Whether the GPU takes S3TC (DXT) textures, sRGB included: the game's images can then skip decoding. */
const S3TC = (() => {
  try {
    const gl = document.createElement('canvas').getContext('webgl2')
    return !!gl?.getExtension('WEBGL_compressed_texture_s3tc') && !!gl.getExtension('WEBGL_compressed_texture_s3tc_srgb')
  } catch { return false }
})()

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

/** Rough overall progress from the worker's stage messages (download and file reading come before). */
function stageProgress(stage: string): number | null {
  if (stage.startsWith('Recherche')) return 0.36
  if (stage.startsWith('Décompression')) return 0.4
  if (stage.startsWith('Lecture')) return 0.5
  if (stage.startsWith('Construction')) return 0.58
  const t = /^Textures (\d+)\/(\d+)/.exec(stage)
  if (t) return 0.62 + 0.36 * (Number(t[1]) / Math.max(1, Number(t[2])))
  return null
}

/** Download with progress (0-1) when the server sends a length. */
async function download(url: string, onProgress: (p: number) => void): Promise<ArrayBuffer> {
  const r = await fetch(url)
  if (!r.ok || !r.body) throw new Error(`${url} : HTTP ${r.status}`)
  const total = Number(r.headers.get('content-length')) || 0
  const chunks: Uint8Array[] = []
  let got = 0
  const reader = r.body.getReader()
  for (let c = await reader.read(); !c.done; c = await reader.read()) {
    chunks.push(c.value); got += c.value.length
    if (total) onProgress(got / total)
  }
  const out = new Uint8Array(got)
  let o = 0
  for (const c of chunks) { out.set(c, o); o += c.length }
  return out.buffer
}

interface Server { maps: string[] | null; iwd: IwdSource[]; images: ImageSource | null }
interface Local { root: FileSystemDirectoryHandle; info: MapInfo; iwd: IwdSource[]; images: ImageSource | null }

function App() {
  const [server, setServer] = useState<Server>({ maps: null, iwd: [], images: null })
  const [local, setLocal] = useState<Local | null>(null)
  const [session, setSession] = useState<{ source: MapSource; file: string } | null>(null)
  /** loading screen shown until the textures are in (or the map is ready without them) */
  const [loading, setLoading] = useState(false)
  const [stage, setStage] = useState('')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [world, setWorld] = useState<MapWorld | null>(null)
  useEffect(() => setFog(world?.fog ?? null), [world])
  const [texturing, setTexturing] = useState('')
  const [fly, setFly] = useState(false)
  const [layers, setLayers] = useState<Layers>({ collision: false, spawns: false, objectives: true, triggers: false })
  const [debug, setDebug] = useState(false)
  const [paused, setPaused] = useState(false)
  const [spawnIndex, setSpawnIndex] = useState(0)
  const worker = useRef<Worker | null>(null)

  // maps shared by the server that hosts this page (absent on static hosting)
  useEffect(() => {
    Promise.all([
      fetch('/__inputs-list/maps').then(r => (r.ok ? r.json() : null)).catch(() => null) as Promise<{ code: string }[] | null>,
      fetch('/__inputs-list/main').then(r => (r.ok ? r.json() : [])).catch(() => []) as Promise<string[]>,
    ]).then(([maps, iwds]) => {
      const iwd = (Array.isArray(iwds) ? iwds : []).map(n => ({ url: `/__inputs/main/${n}` }))
      setServer({ maps: Array.isArray(maps) ? maps.map(m => `mp_${m.code}.ff`) : null, iwd, images: iwd.length ? createImageSource(iwd) : null })
    })
  }, [])

  const toMenu = useCallback((message: string | null = null) => {
    worker.current?.terminate(); worker.current = null
    if (document.pointerLockElement) document.exitPointerLock()
    setWorld(null); setSession(null); setLoading(false); setPaused(false); setTexturing(''); setError(message)
  }, [])

  const runWorker = useCallback((buffer: ArrayBuffer, fileName: string, iwd: IwdSource[]) => {
    worker.current?.terminate()
    const w = new Worker(new URL('./worker/mapWorker.ts', import.meta.url), { type: 'module' })
    worker.current = w
    w.onmessage = (e: MessageEvent<MapResponse>) => {
      const m = e.data
      if (m.type === 'progress') {
        setStage(m.stage)
        const p = stageProgress(m.stage)
        if (p !== null) setProgress(p)
        if (m.stage.startsWith('Textures')) setTexturing(m.stage)
      } else if (m.type === 'error') toMenu(`Échec du chargement de ${fileName} : ${m.message}`)
      else if (m.type === 'textures') {
        setWorld(prev => prev && { ...prev, textures: m.textures, materialImages: m.materialImages, materialNormals: m.materialNormals, sky: m.sky, stats: { ...prev.stats, textures: m.textures.length, msTextures: m.ms } })
        setTexturing(''); setLoading(false); setProgress(1); w.terminate()
      } else {
        setWorld({ ...m, materialImages: {}, materialNormals: {}, textures: [], sky: null })
        ;(window as unknown as { __mapStats?: unknown }).__mapStats = m.stats
        if (iwd.length === 0) { setLoading(false); w.terminate() } else { setProgress(0.6); setStage('Textures') }
      }
    }
    w.onerror = ev => toMenu(ev.message)
    w.postMessage({ buffer, fileName, iwd, s3tc: S3TC }, [buffer])
  }, [toMenu])

  const start = useCallback(async (source: MapSource, file: string) => {
    toMenu()
    setSession({ source, file }); setLoading(true); setProgress(0); setStage('Téléchargement')
    try {
      if (source === 'server') {
        const code = file.replace(/^mp_/, '').replace(/\.ff$/, '')
        const buffer = await download(`/__inputs/zone/${code}/${file}`, p => setProgress(0.35 * p))
        runWorker(buffer, file, server.iwd)
      } else if (local) {
        setStage('Lecture du fichier')
        runWorker(await readMapFile(local.root, file), file, local.iwd)
      }
    } catch (e) { toMenu(e instanceof Error ? e.message : String(e)) }
  }, [toMenu, runWorker, server.iwd, local])

  const pickFolder = useCallback(async () => {
    try {
      const root = await (window as unknown as { showDirectoryPicker(): Promise<FileSystemDirectoryHandle> }).showDirectoryPicker()
      const [info, iwd] = await Promise.all([detectMW3Paths(root), listIwd(root)])
      setLocal({ root, info, iwd, images: iwd.length ? createImageSource(iwd) : null })
      setError(info.maps.length ? null : `Aucune map (mp_*.ff) trouvée dans « ${root.name} ».`)
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  // ?map=dome (or the older ?dev=dome) opens a server map directly, without the menu
  const autostart = useRef(new URLSearchParams(location.search).get('map') ?? new URLSearchParams(location.search).get('dev'))
  useEffect(() => {
    const code = autostart.current
    if (!code || server.maps === null) return
    autostart.current = null
    start('server', `mp_${code}.ff`)
  }, [server.maps, start])

  const inGame = !!world && !loading
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || !inGame) return
      if (e.code === 'KeyC') setLayers(l => ({ ...l, collision: !l.collision }))
      if (e.code === 'KeyO') setLayers(l => ({ ...l, spawns: !l.spawns }))
      if (e.code === 'KeyB') setLayers(l => ({ ...l, objectives: !l.objectives }))
      if (e.code === 'KeyG') setLayers(l => ({ ...l, triggers: !l.triggers }))
      if (e.code === 'KeyI') setDebug(v => !v)
      if (e.code === 'KeyT') setSpawnIndex(i => i + (e.shiftKey ? -1 : 1))
      // with the pointer captured, Escape releases it (and the pause menu opens below); without it, Escape toggles the menu
      if (e.code === 'Escape' && !document.pointerLockElement) setPaused(p => !p)
    }
    // the pause menu opens whenever the pointer is released in game
    const onLock = () => setPaused(!document.pointerLockElement)
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerlockchange', onLock)
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerlockchange', onLock) }
  }, [inGame])

  const spawnList = useMemo(() => (world ? teleportSpawns(world) : []), [world])
  useEffect(() => setSpawnIndex(0), [world?.fileName])
  const spawn = useMemo(() => (world ? spawnPose(spawnList[wrap(spawnIndex, spawnList.length)]) : null), [world, spawnList, spawnIndex])
  const images = session?.source === 'server' ? server.images : local?.images ?? null

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden', background: '#07090a' }}>
      <Canvas flat camera={{ position: [0, 3, 5], fov: 75, near: 0.05, far: 6000 }} style={{ width: '100%', height: '100%' }}>
        <color attach="background" args={['#9fb4c7']} />
        {world?.sky && <Sky sky={world.sky} />}
        <hemisphereLight args={['#cfdcee', '#7a6a55', 0.9]} />
        {import.meta.env.DEV && <RenderStats />}
        <directionalLight
          position={world?.sun ? world.sun.direction.map(v => v * 500) as [number, number, number] : [300, 500, 200]}
          color={world?.sun ? new THREE.Color(...world.sun.color.map(c => Math.min(1, c / Math.max(...world.sun!.color, 1)))) : '#ffffff'}
          intensity={1.5}
        />
        {world && spawn && (
          <Physics gravity={[0, -20, 0]} paused={loading}>
            <WorldMesh world={world} showCollision={layers.collision} />
            <StaticModels world={world} />
            {layers.spawns && <SpawnMarkers spawns={world.spawns} />}
            {layers.objectives && <Objectives objectives={world.objectives} />}
            {layers.triggers && <Triggers triggers={world.triggers} />}
            <Player spawn={spawn.pos} yaw={spawn.yaw} onFly={setFly} />
          </Physics>
        )}
      </Canvas>

      {inGame && world && (
        <Hud world={world} fly={fly} spawn={{ index: wrap(spawnIndex, spawnList.length), count: spawnList.length }}
          texturing={texturing} layers={layers} debug={debug} />
      )}
      {inGame && paused && session && (
        <PauseMenu file={session.file} layers={layers} onToggle={k => setLayers(l => ({ ...l, [k]: !l[k] }))}
          onResume={() => setPaused(false)} onQuit={() => toMenu()} />
      )}
      {loading && session && <LoadingScreen file={session.file} images={images} stage={stage} progress={progress} />}
      {!session && (
        <MainMenu serverMaps={server.maps} serverImages={server.images}
          local={local && { name: local.info.path, maps: local.info.maps }} localImages={local?.images ?? null}
          onPickFolder={pickFolder} onLoad={start} error={error} />
      )}
    </div>
  )
}

export default App
