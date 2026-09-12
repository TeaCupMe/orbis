import { useEffect, useMemo, useRef, useState } from 'react'
import type { Simulation } from '../api'

type Props = {
  t_s: number
  step_s: number
  horizon_s: number
  simulation: Simulation | null
  clientId: string
  playing: boolean
  onPlayingChange: (playing: boolean) => void
  onTimeChange: (t: number) => void
  routeLabel: string
}

function formatTime(s: number) {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${h}ч ${m.toString().padStart(2, '0')}м`
}

export function TimeScrubber({
  t_s,
  step_s,
  horizon_s,
  simulation,
  clientId,
  playing,
  onPlayingChange,
  onTimeChange,
  routeLabel,
}: Props) {
  const maxT = Math.max(0, horizon_s - step_s)
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)

  const segs = useMemo(() => {
    if (!simulation?.availability[clientId]) return null
    const avail = simulation.availability[clientId]
    const vis = simulation.visibility[clientId]
    const n = avail.length
    const out: Array<{ start: number; end: number; kind: 'ok' | 'vis' | 'out' }> = []
    for (let i = 0; i < n; i++) {
      const kind: 'ok' | 'vis' | 'out' = avail[i] ? 'ok' : vis[i] ? 'vis' : 'out'
      const last = out[out.length - 1]
      if (last && last.kind === kind) last.end = i + 1
      else out.push({ start: i, end: i + 1, kind })
    }
    return { segs: out, n }
  }, [simulation, clientId])

  const tFromClientX = (clientX: number) => {
    const el = trackRef.current
    if (!el) return t_s
    const rect = el.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    const raw = ratio * maxT
    return Math.round(raw / step_s) * step_s
  }

  useEffect(() => {
    if (!playing) return
    const id = window.setInterval(() => {
      const next = t_s + step_s
      if (next > maxT) {
        onPlayingChange(false)
        return
      }
      onTimeChange(next)
    }, 350)
    return () => window.clearInterval(id)
  }, [playing, t_s, step_s, maxT, onTimeChange, onPlayingChange])

  useEffect(() => {
    if (!dragging) return
    const move = (e: PointerEvent) => onTimeChange(tFromClientX(e.clientX))
    const up = () => setDragging(false)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [dragging, onTimeChange])

  const cursorPct = maxT > 0 ? (t_s / maxT) * 100 : 0

  return (
    <div className="time-overlay">
      <div className="time-overlay-row">
        <button
          type="button"
          className="btn play-btn"
          onClick={() => onPlayingChange(!playing)}
          title={playing ? 'Пауза' : 'Воспроизведение'}
        >
          {playing ? '⏸' : '▶'}
        </button>
        <span className="time-label">
          {formatTime(t_s)} · {t_s} с
        </span>
        <span className="route-inline">{routeLabel}</span>
      </div>
      <div
        className="scrub-track"
        ref={trackRef}
        onPointerDown={(e) => {
          setDragging(true)
          onPlayingChange(false)
          onTimeChange(tFromClientX(e.clientX))
        }}
      >
        {segs ? (
          <div className="scrub-segs">
            {segs.segs.map((s, i) => (
              <div
                key={i}
                className={`scrub-seg seg-${s.kind}`}
                style={{
                  left: `${(s.start / segs.n) * 100}%`,
                  width: `${((s.end - s.start) / segs.n) * 100}%`,
                }}
              />
            ))}
          </div>
        ) : (
          <div className="scrub-segs scrub-empty" />
        )}
        <div className="scrub-cursor" style={{ left: `${cursorPct}%` }} />
        <input
          className="scrub-range"
          type="range"
          min={0}
          max={maxT}
          step={step_s}
          value={t_s}
          onChange={(e) => {
            onPlayingChange(false)
            onTimeChange(Number(e.target.value))
          }}
          aria-label="Время расчёта"
        />
      </div>
    </div>
  )
}
