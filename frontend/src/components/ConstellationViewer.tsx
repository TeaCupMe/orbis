import { useMemo, useState } from 'react'
import type { SnapshotAnalysis } from '../api'
import { Map2DView } from './Map2DView'
import { Globe3DView } from './Globe3DView'

type Props = {
  analysis: SnapshotAnalysis
  clientId: string
  path: string[]
}

export function ConstellationViewer({ analysis, clientId, path }: Props) {
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
          <span className="dot active-sat" /> активный КА
          <span className="dot inactive-sat" /> неактивный
          <span className="dot ground" /> наземный пункт
          <span className="line route" /> маршрут
          <span className="line isl" /> ISL
        </div>
      </div>
      <div className="viewer-stage">
        {mode === '2d' ? (
          <Map2DView analysis={analysis} path={path} pathSet={pathSet} clientId={clientId} />
        ) : (
          <Globe3DView analysis={analysis} path={path} pathSet={pathSet} />
        )}
      </div>
    </div>
  )
}
