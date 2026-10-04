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
import type { MapWorld } from './types'
import { registerMapName } from './mapNames'
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

/** A map found in the player's folder: where it is, and the archives that sit next to it (community maps ship their own). */
interface LocalMap { dir: FileSystemDirectoryHandle; ownIwd: File[] }
interface LocalLibrary { maps: Map<string, LocalMap>; mainIwd: IwdSource[] }

/**
 * Looks for maps in the folder itself, zone/<anything>/, usermaps/<anything>/ and its direct sub-folders (so picking
 * `usermaps` works too). The base game's archives are the .iwd of the folder and of main/.
 */
async function scanLocal(root: FileSystemDirectoryHandle): Promise<LocalLibrary> {
  const dirs: FileSystemDirectoryHandle[] = []
  const subDirs = async (dir: FileSystemDirectoryHandle) => {
    const out: FileSystemDirectoryHandle[] = []
    for await (const entry of entries(dir)) if (entry.kind === 'directory' && !entry.name.startsWith('.')) out.push(await dir.getDirectoryHandle(entry.name))
    return out
  }
  dirs.push(root)
  for (const name of ['zone', 'usermaps']) {
    try { dirs.push(...await subDirs(await root.getDirectoryHandle(name))) } catch { /* absent */ }
  }
  try { dirs.push(...(await subDirs(root)).filter(d => !['zone', 'usermaps', 'main'].includes(d.name))) } catch { /* unreadable */ }

  const maps = new Map<string, LocalMap>()
  for (const dir of dirs) {
    const files = await listFiles(dir, () => true)
    const found = files.filter(isMapFile)
    if (!found.length) continue
    const ownIwd = dir === root ? [] : await Promise.all(files.filter(n => n.endsWith('.iwd')).map(async n => (await (await dir.getFileHandle(n)).getFile())))
    for (const file of found) {
      if (maps.has(file)) continue
      maps.set(file, { dir, ownIwd })
      const code = file.replace(/^mp_/, '').replace(/\.ff$/i, '')
      if (files.includes(`mp_${code}.arena`)) {
        const text = await (await (await dir.getFileHandle(`mp_${code}.arena`)).getFile()).text()
        registerMapName(code, /longname\s+"([^"]*)"/i.exec(text)?.[1])
      }
    }
  }
  const mainIwd: IwdSource[] = []
  const collect = async (dir: FileSystemDirectoryHandle) => {
    for await (const entry of entries(dir)) {
      if (entry.kind === 'file' && entry.name.endsWith('.iwd') && !entry.name.startsWith('.')) mainIwd.push({ file: await (entry as FileSystemFileHandle).getFile() })
    }
  }
  await collect(root)
  try { await collect(await root.getDirectoryHandle('main')) } catch { /* no main/ */ }
  return { maps, mainIwd }
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

/** A map offered by the server: where to download it and the archives that come with it (full URLs). */
interface ServerMap { url: string; iwd: string[] }
interface Server { maps: string[] | null; byFile: Record<string, ServerMap>; iwd: IwdSource[]; images: ImageSource | null }
interface MapListing { code: string; name?: string; path: string; iwd: string[] }

const BASE = import.meta.env.BASE_URL
const STATIC = !!import.meta.env.VITE_STATIC
// no-cache: revalidate, so a redeployed site never pairs a stale manifest (Pages caches 10 min) with renamed files
const getJson = async <T,>(url: string): Promise<T | null> => { try { const r = await fetch(url, { cache: 'no-cache' }); return r.ok ? await r.json() as T : null } catch { return null } }
interface Local { name: string; library: LocalLibrary; images: ImageSource | null }

function App() {
  const [server, setServer] = useState<Server>({ maps: null, byFile: {}, iwd: [], images: null })
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

  // maps offered by the page's host: the ones shipped with the project (in the build, also on static hosting), then those of
  // the folder the server shares (dev and `vite preview` only); a code found twice keeps the shipped one
  useEffect(() => {
    Promise.all([
      getJson<MapListing[]>(`${BASE}maps/manifest.json`),
      // a static build (VITE_STATIC=1, e.g. GitHub Pages) has no shared folder: skip the requests that would 404
      STATIC ? null : getJson<MapListing[]>(`${BASE}__inputs-list/maps`),
      STATIC ? null : getJson<string[]>(`${BASE}__inputs-list/main`),
    ]).then(([shipped, shared, mainIwd]) => {
      const byFile: Record<string, ServerMap> = {}
      const images: IwdSource[] = []
      const add = (list: MapListing[] | null, prefix: string) => {
        for (const m of Array.isArray(list) ? list : []) {
          const file = `mp_${m.code}.ff`
          if (byFile[file]) continue
          byFile[file] = { url: `${BASE}${prefix}${m.path}`, iwd: m.iwd.map(u => `${BASE}${prefix}${u}`) }
          registerMapName(m.code, m.name)
          images.push(...byFile[file].iwd.map(url => ({ url })))
        }
      }
      add(shipped, 'maps/')
      add(shared, '__inputs/')
      const iwd = (Array.isArray(mainIwd) ? mainIwd : []).map(n => ({ url: `${BASE}__inputs/main/${n}` }))
      const files = Object.keys(byFile)
      // the menu's images: the game's archives first, then the community maps' own (their loading screens)
      setServer({ maps: shipped || shared ? files : null, byFile, iwd, images: iwd.length + images.length ? createImageSource([...iwd, ...images]) : null })
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
        const entry = server.byFile[file]
        if (!entry) throw new Error(`${file} n'est pas sur le serveur`)
        const buffer = await download(entry.url, p => setProgress(0.35 * p))
        // base textures: the server's copy of the game if it has one, else the visitor's own folder (never shipped)
        const game = server.iwd.length ? server.iwd : local?.library.mainIwd ?? []
        runWorker(buffer, file, [...game, ...entry.iwd.map(url => ({ url }))])
      } else if (local) {
        setStage('Lecture du fichier')
        const entry = local.library.maps.get(file)
        if (!entry) throw new Error(`${file} introuvable`)
        const buffer = await (await (await entry.dir.getFileHandle(file)).getFile()).arrayBuffer()
        runWorker(buffer, file, [...local.library.mainIwd, ...entry.ownIwd.map(f => ({ file: f }))])
      }
    } catch (e) { toMenu(e instanceof Error ? e.message : String(e)) }
  }, [toMenu, runWorker, server.iwd, server.byFile, local])

  const pickFolder = useCallback(async () => {
    try {
      const root = await (window as unknown as { showDirectoryPicker(): Promise<FileSystemDirectoryHandle> }).showDirectoryPicker()
      const library = await scanLocal(root)
      const all = [...library.mainIwd, ...[...library.maps.values()].flatMap(m => m.ownIwd).map(f => ({ file: f }))]
      setLocal({ name: root.name, library, images: all.length ? createImageSource(all) : null })
      setError(library.maps.size ? null : `Aucune map (mp_*.ff) trouvée dans « ${root.name} ».`)
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
        <MainMenu serverMaps={server.maps} serverImages={server.images} serverHasGame={server.iwd.length > 0 || !!local?.library.mainIwd.length}
          local={local && { name: local.name, maps: [...local.library.maps.keys()].sort() }} localImages={local?.images ?? null}
          onPickFolder={pickFolder} onLoad={start} error={error} />
      )}
    </div>
  )
}

export default App
