import { useEffect, useMemo, useRef, useState } from 'react'
import { Api, type CoverageGrid, type SnapshotAnalysis, type Simulation } from '../api'
import { Map2DView } from './Map2DView'
import { Globe3DView } from './Globe3DView'
import { TimeScrubber } from './TimeScrubber'

type Props = {
  analysis: SnapshotAnalysis
  clientId: string
  path: string[]
  t_s: number
  step_s: number
  horizon_s: number
  simulation: Simulation | null
  playing: boolean
  onPlayingChange: (playing: boolean) => void
  onTimeChange: (t: number) => void
  onSelectClient: (id: string) => void
  routeLabel: string
}

export function ConstellationViewer({
  analysis,
  clientId,
  path,
  t_s,
  step_s,
  horizon_s,
  simulation,
  playing,
  onPlayingChange,
  onTimeChange,
  onSelectClient,
  routeLabel,
}: Props) {
  const [mode, setMode] = useState<'2d' | '3d'>('2d')
  const [viewLayer, setViewLayer] = useState<'network' | 'coverage'>('network')
  const [coverage, setCoverage] = useState<CoverageGrid | null>(null)
  const [coverageBusy, setCoverageBusy] = useState(false)
  const cacheRef = useRef<Map<number, CoverageGrid>>(new Map())

  const pathSet = useMemo(() => {
    const edges = new Set<string>()
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i]
      const b = path[i + 1]
      edges.add([a, b].sort().join('|'))
    }
    return edges
  }, [path])

  useEffect(() => {
    if (viewLayer !== 'coverage') return
    const cached = cacheRef.current.get(t_s)
    if (cached) {
      setCoverage(cached)
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      setCoverageBusy(true)
      void Api.coverage(t_s)
        .then((grid) => {
          if (cancelled) return
          cacheRef.current.set(t_s, grid)
          setCoverage(grid)
        })
        .catch(() => {
          if (!cancelled) setCoverage(null)
        })
        .finally(() => {
          if (!cancelled) setCoverageBusy(false)
        })
    }, 120)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [viewLayer, t_s])

  // invalidate coverage cache when analysis scenario identity changes (new sats positions source)
  useEffect(() => {
    cacheRef.current.clear()
  }, [analysis.ground_sites, analysis.snapshot.satellites.length])

  const coverPct =
    coverage && viewLayer === 'coverage'
      ? `покрытие ${(coverage.covered_fraction * 100).toFixed(1)}%`
      : null

  return (
    <div className="viewer">
      <div className="viewer-toolbar">
        <div className="toggle">
          <button
            type="button"
            className={mode === '2d' ? 'active' : ''}
            onClick={() => setMode('2d')}
          >
            Плоская карта
          </button>
          <button
            type="button"
            className={mode === '3d' ? 'active' : ''}
            onClick={() => setMode('3d')}
          >
            3D вокруг Земли
          </button>
        </div>
        <div className="toggle">
          <button
            type="button"
            className={viewLayer === 'network' ? 'active' : ''}
            onClick={() => setViewLayer('network')}
          >
            Сеть / маршрут
          </button>
          <button
            type="button"
            className={viewLayer === 'coverage' ? 'active' : ''}
            onClick={() => setViewLayer('coverage')}
          >
            Покрытие
          </button>
        </div>
        <div className="legend">
          {viewLayer === 'network' ? (
            <>
              <span className="hint">ЛКМ по клиенту — маршрут</span>
              <span className="dot active-sat" /> активный КА
              <span className="dot ground" /> наземный
              <span className="line route" /> маршрут
            </>
          ) : (
            <>
              <span className="hint">теплокарта: видимость ≥1 КА</span>
              {coverageBusy && <span className="muted">считаем…</span>}
              {coverPct && <span>{coverPct}</span>}
            </>
          )}
        </div>
        {viewLayer === 'network' && (
          <span className="client-chip">клиент: {clientId || '—'}</span>
        )}
      </div>
      <div className="viewer-stage">
        {mode === '2d' ? (
          <Map2DView
            analysis={analysis}
            path={path}
            pathSet={pathSet}
            clientId={clientId}
            onSelectClient={onSelectClient}
            viewLayer={viewLayer}
            coverage={coverage}
          />
        ) : (
          <Globe3DView
            analysis={analysis}
            path={path}
            pathSet={pathSet}
            clientId={clientId}
            onSelectClient={onSelectClient}
            viewLayer={viewLayer}
            coverage={coverage}
          />
        )}
        <TimeScrubber
          t_s={t_s}
          step_s={step_s}
          horizon_s={horizon_s}
          simulation={simulation}
          clientId={clientId}
          playing={playing}
          onPlayingChange={onPlayingChange}
          onTimeChange={onTimeChange}
          routeLabel={
            viewLayer === 'coverage'
              ? coverPct ?? (coverageBusy ? 'расчёт покрытия…' : 'покрытие')
              : routeLabel
          }
        />
      </div>
    </div>
  )
}
