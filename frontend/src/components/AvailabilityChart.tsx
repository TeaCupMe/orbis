import type { Simulation } from '../api'

type Props = {
  simulation: Simulation
  clientId?: string
  currentT?: number
}

export function AvailabilityChart({ simulation, clientId, currentT }: Props) {
  const cid = clientId ?? Object.keys(simulation.availability)[0]
  if (!cid || !simulation.availability[cid]) return null
  const avail = simulation.availability[cid]
  const vis = simulation.visibility[cid]
  const n = avail.length
  const w = 720
  const h = 56
  const step = w / n

  const segs: Array<{ x: number; width: number; kind: 'ok' | 'vis' | 'out' }> = []
  for (let i = 0; i < n; i++) {
    const kind = avail[i] ? 'ok' : vis[i] ? 'vis' : 'out'
    const last = segs[segs.length - 1]
    if (last && last.kind === kind) last.width += step
    else segs.push({ x: i * step, width: step, kind })
  }

  const curX =
    currentT != null
      ? (currentT / simulation.step_s) * step
      : null

  return (
    <div className="avail-chart">
      <div className="avail-head">
        <strong>{cid}</strong>
        <span className="muted">
          зелёный — есть маршрут · жёлтый — видимость без маршрута · серый — нет видимости
        </span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="avail-svg" role="img">
        {segs.map((s, i) => (
          <rect
            key={i}
            x={s.x}
            y={12}
            width={Math.max(s.width, 0.5)}
            height={28}
            className={`seg-${s.kind}`}
          />
        ))}
        {curX != null && (
          <line x1={curX} x2={curX} y1={4} y2={h - 4} className="cursor" />
        )}
      </svg>
    </div>
  )
}
