import { useEffect, useRef, useState } from 'react'
import { touch } from '../touchInput'

const RADIUS = 56

/** a key press the app already handles (V fly, T spawn, Escape menu), replayed from a button */
const tap = (code: string) => document.dispatchEvent(new KeyboardEvent('keydown', { code }))

/** Touch overlay: left stick to move, drag anywhere else to look, buttons for jump, crouch/descend, fly, spawn and menu. */
export function TouchControls() {
  const knob = useRef<HTMLDivElement>(null)
  const look = useRef<{ id: number; x: number; y: number } | null>(null)
  const stick = useRef<{ id: number; x: number; y: number } | null>(null)
  // not offered where the browser has no Fullscreen API (iPhone Safari)
  const canFullscreen = document.fullscreenEnabled
  const [full, setFull] = useState(!!document.fullscreenElement)
  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])

  useEffect(() => {
    touch.active = true
    return () => { Object.assign(touch, { active: false, moveX: 0, moveY: 0, jump: false, crouch: false, lookX: 0, lookY: 0 }) }
  }, [])

  const setStick = (dx: number, dy: number) => {
    const len = Math.hypot(dx, dy), k = len > RADIUS ? RADIUS / len : 1
    touch.moveX = (dx * k) / RADIUS; touch.moveY = (dy * k) / RADIUS
    if (knob.current) knob.current.style.transform = `translate(${dx * k}px, ${dy * k}px)`
  }
  const hold = (key: 'jump' | 'crouch') => ({
    onPointerDown: (e: React.PointerEvent) => { e.currentTarget.setPointerCapture(e.pointerId); touch[key] = true },
    onPointerUp: () => { touch[key] = false },
    onPointerCancel: () => { touch[key] = false },
  })

  return (
    <div
      className="touch"
      onPointerDown={e => { if (e.target === e.currentTarget && !look.current) { e.currentTarget.setPointerCapture(e.pointerId); look.current = { id: e.pointerId, x: e.clientX, y: e.clientY } } }}
      onPointerMove={e => {
        const l = look.current
        if (!l || l.id !== e.pointerId) return
        touch.lookX += e.clientX - l.x; touch.lookY += e.clientY - l.y; l.x = e.clientX; l.y = e.clientY
      }}
      onPointerUp={e => { if (look.current?.id === e.pointerId) look.current = null }}
      onPointerCancel={e => { if (look.current?.id === e.pointerId) look.current = null }}
    >
      <div
        className="touch-stick"
        onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); const r = e.currentTarget.getBoundingClientRect(); stick.current = { id: e.pointerId, x: r.left + r.width / 2, y: r.top + r.height / 2 }; setStick(e.clientX - stick.current.x, e.clientY - stick.current.y) }}
        onPointerMove={e => { const s = stick.current; if (s?.id === e.pointerId) setStick(e.clientX - s.x, e.clientY - s.y) }}
        onPointerUp={() => { stick.current = null; setStick(0, 0) }}
        onPointerCancel={() => { stick.current = null; setStick(0, 0) }}
      >
        <div className="touch-knob" ref={knob} />
      </div>
      <div className="touch-buttons caps">
        <button className="touch-btn big" {...hold('jump')}>Saut</button>
        <button className="touch-btn" {...hold('crouch')}>Bas</button>
        <button className="touch-btn" onClick={() => tap('KeyV')}>Vol</button>
        <button className="touch-btn" onClick={() => tap('KeyT')}>Spawn</button>
      </div>
      <div className="touch-top caps">
        {canFullscreen && (
          <button className="touch-btn" aria-label={full ? 'Quitter le plein écran' : 'Plein écran'} style={{ minWidth: 40, fontSize: 20 }} onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen({ navigationUI: 'hide' }))}>
            {full ? '⤡' : '⤢'}
          </button>
        )}
        <button className="touch-btn" onClick={() => tap('Escape')}>Menu</button>
      </div>
    </div>
  )
}
