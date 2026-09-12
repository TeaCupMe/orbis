import { useMemo } from 'react'
import type { CompareFleetTimeline } from '../api'
import { formatTime, pct } from '../format'

type Props = {
  label: string
  timeline: CompareFleetTimeline
}

type Seg = { level: 'full' | 'partial' | 'none'; start: number; len: number }

function mergeLevels(levels: string[]): Seg[] {
  const segs: Seg[] = []
  for (let i = 0; i < levels.length; i++) {
    const level = levels[i] as Seg['level']
    const last = segs[segs.length - 1]
    if (last && last.level === level) last.len += 1
    else segs.push({ level, start: i, len: 1 })
  }
  return segs
}

export function CompareAvailabilityTimeline({ label, timeline }: Props) {
  const n = timeline.levels.length
  const segs = useMemo(() => mergeLevels(timeline.levels), [timeline.levels])
  if (n === 0) return null

  const total = timeline.counts.full + timeline.counts.partial + timeline.counts.none
  const w = 720
  const h = 44
  const step = w / n

  return (
    <div className="compare-timeline">
      <div className="compare-timeline-head">
        <strong>{label}</strong>
        <span className="muted tiny">
          полный {pct(timeline.counts.full / total)} · частичный{' '}
          {pct(timeline.counts.partial / total)} · нет {pct(timeline.counts.none / total)}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="compare-timeline-svg"
        role="img"
        aria-label={label}
      >
        {segs.map((s, i) => (
          <rect
            key={i}
            x={s.start * step}
            y={10}
            width={Math.max(s.len * step, 0.5)}
            height={24}
            className={`fleet-seg fleet-${s.level}`}
          >
            <title>
              {s.level}: {formatTime(timeline.times[s.start] ?? 0)}–
              {formatTime(
                (timeline.times[Math.min(s.start + s.len - 1, n - 1)] ?? 0) +
                  (timeline.step_s ?? 0),
              )}
            </title>
          </rect>
        ))}
      </svg>
      <div className="compare-timeline-axis muted tiny">
        <span>0</span>
        <span>{formatTime(timeline.horizon_s || (n * (timeline.step_s || 0)))}</span>
      </div>
    </div>
  )
}
