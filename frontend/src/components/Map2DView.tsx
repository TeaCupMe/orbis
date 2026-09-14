import { MapContainer, TileLayer, CircleMarker, Polyline, Polygon, Tooltip, Pane, ImageOverlay } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { useMemo } from 'react'
import type { CoverageGrid, SnapshotAnalysis } from '../api'
import { coverageToDataUrl } from '../coverageRender'
import {
  ecefToLatLon,
  footprintHalfAngleRad,
  footprintRingLatLon,
} from '../footprint'
import { useMedia } from '../useMedia'

type Props = {
  analysis: SnapshotAnalysis
  path: string[]
  pathSet: Set<string>
  alternatePaths?: string[][]
  altIndex?: number
  clientId: string
  onSelectClient: (id: string) => void
  selectedSatId: string | null
  onSelectSat: (id: string) => void
  minElevationDeg: number
  viewLayer: 'network' | 'coverage'
  coverage: CoverageGrid | null
}

function key(a: string, b: string) {
  return [a, b].sort().join('|')
}

export function Map2DView({
  analysis,
  path,
  pathSet,
  alternatePaths = [],
  altIndex = 0,
  clientId,
  onSelectClient,
  selectedSatId,
  onSelectSat,
  minElevationDeg,
  viewLayer,
  coverage,
}: Props) {
  const sats = analysis.snapshot.satellites
  const satIds = useMemo(() => new Set(sats.map((s) => s.id)), [sats])
  const byId = new Map(sats.map((s) => [s.id, s]))
  const ground = analysis.ground_sites
  const showNetwork = viewLayer === 'network'
  const touchFriendly = useMedia('(max-width: 480px), (pointer: coarse)')
  const satR = touchFriendly ? 4 : 0
  const groundR = touchFriendly ? 4 : 0

  const coverageUrl = useMemo(
    () => (coverage ? coverageToDataUrl(coverage) : null),
    [coverage],
  )

  const footprintRing = useMemo(() => {
    if (!selectedSatId || !showNetwork) return null
    const sat = byId.get(selectedSatId)
    if (!sat) return null
    const r = Math.hypot(sat.x_km, sat.y_km, sat.z_km)
    const psi = footprintHalfAngleRad(r, minElevationDeg)
    if (psi <= 0) return null
    const { lat, lon } = ecefToLatLon(sat.x_km, sat.y_km, sat.z_km)
    return footprintRingLatLon(lat, lon, psi, 96)
  }, [selectedSatId, showNetwork, sats, minElevationDeg])

  const posOf = (id: string): [number, number] | null => {
    const sat = byId.get(id)
    if (sat?.lat_deg != null && sat.lon_deg != null) return [sat.lat_deg, sat.lon_deg]
    const g = ground.find((x) => x.id === id)
    if (g) return [g.lat_deg, g.lon_deg]
    return null
  }

  type IslLine = {
    positions: [number, number][]
    highlight: boolean
    a: string
    b: string
  }

  const islLines: IslLine[] = []
  if (showNetwork) {
    for (const [a, b] of analysis.snapshot.edges) {
      if (!satIds.has(a) || !satIds.has(b)) continue
      const pa = posOf(a)
      const pb = posOf(b)
      if (!pa || !pb) continue
      const highlight = Boolean(
        selectedSatId && (a === selectedSatId || b === selectedSatId),
      )
      // Маршрут (в т.ч. станция–КА) рисуем отдельно по path — здесь только ISL.
      if (pathSet.has(key(a, b))) continue
      islLines.push({
        positions: [pa, pb],
        highlight,
        a,
        b,
      })
    }
  }

  const routeSegs: [number, number][][] = []
  if (showNetwork) {
    for (let i = 0; i < path.length - 1; i++) {
      const pa = posOf(path[i])
      const pb = posOf(path[i + 1])
      if (pa && pb) routeSegs.push([pa, pb])
    }
  }

  const ghostAltSegs: [number, number][][][] = []
  if (showNetwork) {
    for (let ai = 0; ai < alternatePaths.length; ai++) {
      if (ai === altIndex) continue
      const ap = alternatePaths[ai]
      const segs: [number, number][][] = []
      for (let i = 0; i < ap.length - 1; i++) {
        const pa = posOf(ap[i])
        const pb = posOf(ap[i + 1])
        if (pa && pb) segs.push([pa, pb])
      }
      if (segs.length) ghostAltSegs.push(segs)
    }
  }

  const dimOthers = Boolean(selectedSatId)

  return (
    <MapContainer
      center={[70, 60]}
      zoom={3}
      className="map2d"
      scrollWheelZoom
      worldCopyJump
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {coverageUrl && viewLayer === 'coverage' && (
        <ImageOverlay
          url={coverageUrl}
          bounds={[
            [-90, -180],
            [90, 180],
          ]}
          opacity={0.65}
          zIndex={350}
          interactive={false}
        />
      )}
      {showNetwork && footprintRing && footprintRing.length >= 4 && (
        <Pane name="footprint" style={{ zIndex: 360 }}>
          <Polygon
            positions={footprintRing}
            pathOptions={{
              color: '#4cc9f0',
              weight: 2,
              opacity: 0.9,
              fillColor: '#4cc9f0',
              fillOpacity: 0.18,
              interactive: false,
            }}
          />
        </Pane>
      )}
      {showNetwork && (
        <Pane name="isl" style={{ zIndex: 400 }}>
          {islLines
            .filter((l) => !l.highlight)
            .map((l, i) => (
              <Polyline
                key={`isl-${i}`}
                positions={l.positions}
                pathOptions={{
                  color: '#5a7a8c',
                  weight: 1,
                  opacity: dimOthers ? 0.12 : 0.35,
                  interactive: false,
                }}
              />
            ))}
        </Pane>
      )}
      {showNetwork && (
        <Pane name="isl-hi" style={{ zIndex: 440 }}>
          {islLines
            .filter((l) => l.highlight)
            .map((l, i) => (
              <Polyline
                key={`isl-hi-${i}`}
                positions={l.positions}
                pathOptions={{
                  color: '#4cc9f0',
                  weight: 3,
                  opacity: 0.95,
                  interactive: false,
                }}
              />
            ))}
        </Pane>
      )}
      {showNetwork && (
        <Pane name="alt-routes" style={{ zIndex: 445 }}>
          {ghostAltSegs.map((segs, gi) =>
            segs.map((positions, i) => (
              <Polyline
                key={`alt-${gi}-${i}`}
                positions={positions}
                pathOptions={{
                  color: '#adb5bd',
                  weight: 2,
                  opacity: 0.55,
                  dashArray: '6 6',
                  interactive: false,
                }}
              />
            )),
          )}
        </Pane>
      )}
      {showNetwork && (
        <Pane name="route" style={{ zIndex: 450 }}>
          {routeSegs.map((positions, i) => (
            <Polyline
              key={`rt-${i}`}
              positions={positions}
              pathOptions={{
                color: '#e85d04',
                weight: 3,
                opacity: 0.95,
                interactive: false,
              }}
            />
          ))}
        </Pane>
      )}
      <Pane name="markers" style={{ zIndex: 650 }}>
        {showNetwork &&
          sats.map((s) => {
            const selected = s.id === selectedSatId
            const neighbor =
              selectedSatId != null &&
              islLines.some(
                (l) =>
                  l.highlight &&
                  (l.a === s.id || l.b === s.id) &&
                  s.id !== selectedSatId,
              )
            return s.lat_deg != null && s.lon_deg != null ? (
              <CircleMarker
                key={s.id}
                center={[s.lat_deg, s.lon_deg]}
                radius={selected ? 10 + satR : s.active ? 7 + satR : 5 + satR}
                eventHandlers={{
                    click: (e) => {
                      e.originalEvent.stopPropagation()
                      onSelectSat(s.id)
                    },
                }}
                pathOptions={{
                  color: selected
                    ? '#4cc9f0'
                    : neighbor
                      ? '#90e0ef'
                      : s.active
                        ? '#0a9396'
                        : '#6c757d',
                  fillColor: selected
                    ? '#4cc9f0'
                    : neighbor
                      ? '#caf0f8'
                      : s.active
                        ? '#94d2bd'
                        : '#adb5bd',
                  fillOpacity: dimOthers && !selected && !neighbor ? 0.35 : 0.95,
                  weight: selected || path.includes(s.id) ? 2 : 1,
                  bubblingMouseEvents: false,
                }}
              >
                <Tooltip>
                  {s.id} {s.active ? 'active' : 'inactive'}
                  {selected ? ' · ISL и зона связи' : ' · клик: связи и footprint'}
                </Tooltip>
              </CircleMarker>
            ) : null
          })}
        {ground.map((g) => (
          <CircleMarker
            key={g.id}
            center={[g.lat_deg, g.lon_deg]}
            radius={g.id === clientId ? 11 + groundR : 9 + groundR}
            eventHandlers={
              g.role === 'client' && showNetwork
                ? {
                    click: (e) => {
                      e.originalEvent.stopPropagation()
                      onSelectClient(g.id)
                    },
                  }
                : undefined
            }
            pathOptions={{
              color: g.id === clientId ? '#e85d04' : g.role === 'gateway' ? '#9b2226' : '#001219',
              fillColor:
                g.id === clientId ? '#e85d04' : g.role === 'gateway' ? '#ae2012' : '#005f73',
              fillOpacity: 1,
              weight: g.id === clientId ? 3 : 1,
              bubblingMouseEvents: false,
            }}
          >
            <Tooltip>
              {g.id} ({g.role}) — {g.name}
              {g.role === 'client' && showNetwork ? ' · клик: маршрут' : ''}
            </Tooltip>
          </CircleMarker>
        ))}
      </Pane>
    </MapContainer>
  )
}
