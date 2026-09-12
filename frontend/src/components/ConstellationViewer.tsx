import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Api,
  type CoverageGrid,
  type SnapshotAnalysis,
  type Simulation,
  type Scenario,
} from '../api'
import { Map2DView } from './Map2DView'
import { Globe3DView } from './Globe3DView'
import { TimeScrubber } from './TimeScrubber'
import { MapLegendOverlay } from './MapLegendOverlay'
import { MapStatsOverlay } from './MapStatsOverlay'

type Props = {
  analysis: SnapshotAnalysis
  clientId: string
  path: string[]
  t_s: number
  step_s: number
  horizon_s: number
  minElevationDeg: number
  gatewayOutages: Scenario['gateway_outages']
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
  minElevationDeg,
  gatewayOutages,
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
  const [selectedSatId, setSelectedSatId] = useState<string | null>(null)
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

  const onSelectSat = (id: string) => {
    setSelectedSatId((prev) => (prev === id ? null : id))
  }

  useEffect(() => {
    if (viewLayer !== 'network') setSelectedSatId(null)
  }, [viewLayer])

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

  useEffect(() => {
    cacheRef.current.clear()
  }, [analysis.ground_sites, analysis.snapshot.satellites.length])

  const coverPct =
    coverage && viewLayer === 'coverage'
      ? `покрытие ${(coverage.covered_fraction * 100).toFixed(1)}%`
      : null

  const satNeighbors = useMemo(() => {
    if (!selectedSatId) return [] as string[]
    const satIds = new Set(analysis.snapshot.satellites.map((s) => s.id))
    const n = new Set<string>()
    for (const [a, b] of analysis.snapshot.edges) {
      if (a === selectedSatId && satIds.has(b)) n.add(b)
      if (b === selectedSatId && satIds.has(a)) n.add(a)
    }
    return [...n]
  }, [selectedSatId, analysis.snapshot.edges, analysis.snapshot.satellites])

  const liveStats = useMemo(() => {
    const sats = analysis.snapshot.satellites
    const activeSats =
      analysis.active_satellites ?? sats.filter((s) => s.active).length
    const inactiveSats =
      analysis.inactive_satellites ?? sats.length - activeSats

    const clients = analysis.ground_sites.filter((g) => g.role === 'client')
    const gateways = analysis.ground_sites.filter((g) => g.role === 'gateway')
    const clientsReachable = clients.filter(
      (g) => analysis.routes[g.id]?.reachable,
    ).length
    const offlineGw = new Set(
      gatewayOutages
        .filter((f) => f.start_s <= t_s && t_s < f.end_s)
        .map((f) => f.gateway_id),
    )
    const gatewaysOnline = gateways.filter((g) => !offlineGw.has(g.id)).length

    return {
      failedSats: inactiveSats,
      activeSats,
      totalSats: sats.length,
      stochasticFailed: analysis.stochastic_failed?.length ?? 0,
      clientsReachable,
      clientsTotal: clients.length,
      gatewaysOnline,
      gatewaysTotal: gateways.length,
    }
  }, [analysis, gatewayOutages, t_s])

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
      </div>
      <div className="viewer-stage">
        {mode === '2d' ? (
          <Map2DView
            analysis={analysis}
            path={path}
            pathSet={pathSet}
            clientId={clientId}
            onSelectClient={onSelectClient}
            selectedSatId={selectedSatId}
            onSelectSat={onSelectSat}
            minElevationDeg={minElevationDeg}
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
            selectedSatId={selectedSatId}
            onSelectSat={onSelectSat}
            minElevationDeg={minElevationDeg}
            viewLayer={viewLayer}
            coverage={coverage}
          />
        )}
        <div className="map-side-panels">
          <MapLegendOverlay
            viewLayer={viewLayer}
            clientId={clientId}
            selectedSatId={selectedSatId}
            satNeighborCount={satNeighbors.length}
            coverageBusy={coverageBusy}
            coverPct={coverPct}
          />
          <MapStatsOverlay {...liveStats} />
        </div>
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
