import { useMemo, useState } from 'react'
import type { SnapshotAnalysis, Simulation } from '../api'
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

  const pathSet = useMemo(() => {
    const edges = new Set<string>()
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i]
      const b = path[i + 1]
      edges.add([a, b].sort().join('|'))
    }
    return edges
  }, [path])

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
        <div className="legend">
          <span className="hint">ЛКМ по клиенту — маршрут</span>
          <span className="dot active-sat" /> активный КА
          <span className="dot inactive-sat" /> неактивный
          <span className="dot ground" /> наземный
          <span className="line route" /> маршрут
        </div>
        <span className="client-chip">клиент: {clientId || '—'}</span>
      </div>
      <div className="viewer-stage">
        {mode === '2d' ? (
          <Map2DView
            analysis={analysis}
            path={path}
            pathSet={pathSet}
            clientId={clientId}
            onSelectClient={onSelectClient}
          />
        ) : (
          <Globe3DView
            analysis={analysis}
            path={path}
            pathSet={pathSet}
            clientId={clientId}
            onSelectClient={onSelectClient}
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
          routeLabel={routeLabel}
        />
      </div>
    </div>
  )
}
