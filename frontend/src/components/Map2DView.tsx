import { MapContainer, TileLayer, CircleMarker, Polyline, Tooltip, Pane } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import type { SnapshotAnalysis } from '../api'

type Props = {
  analysis: SnapshotAnalysis
  path: string[]
  pathSet: Set<string>
  clientId: string
}

function key(a: string, b: string) {
  return [a, b].sort().join('|')
}

export function Map2DView({ analysis, path, pathSet, clientId }: Props) {
  const sats = analysis.snapshot.satellites
  const byId = new Map(sats.map((s) => [s.id, s]))
  const ground = analysis.ground_sites

  const posOf = (id: string): [number, number] | null => {
    const sat = byId.get(id)
    if (sat?.lat_deg != null && sat.lon_deg != null) return [sat.lat_deg, sat.lon_deg]
    const g = ground.find((x) => x.id === id)
    if (g) return [g.lat_deg, g.lon_deg]
    return null
  }

  const islLines: Array<{ positions: [number, number][]; route: boolean }> = []
  for (const [a, b] of analysis.snapshot.edges) {
    const pa = posOf(a)
    const pb = posOf(b)
    if (!pa || !pb) continue
    // skip very long wrap-around clutter optionally — keep all for accuracy
    islLines.push({ positions: [pa, pb], route: pathSet.has(key(a, b)) })
  }

  // draw route on top even if missing from edges somehow
  const routeLine = path
    .map((id) => posOf(id))
    .filter((p): p is [number, number] => p != null)

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
      <Pane name="isl" style={{ zIndex: 400 }}>
        {islLines
          .filter((l) => !l.route)
          .map((l, i) => (
            <Polyline
              key={`isl-${i}`}
              positions={l.positions}
              pathOptions={{ color: '#5a7a8c', weight: 1, opacity: 0.35 }}
            />
          ))}
      </Pane>
      <Pane name="route" style={{ zIndex: 450 }}>
        {routeLine.length >= 2 && (
          <Polyline
            positions={routeLine}
            pathOptions={{ color: '#e85d04', weight: 3, opacity: 0.95 }}
          />
        )}
      </Pane>
      {sats.map((s) =>
        s.lat_deg != null && s.lon_deg != null ? (
          <CircleMarker
            key={s.id}
            center={[s.lat_deg, s.lon_deg]}
            radius={s.active ? 5 : 3}
            pathOptions={{
              color: s.active ? '#0a9396' : '#6c757d',
              fillColor: s.active ? '#94d2bd' : '#adb5bd',
              fillOpacity: 0.9,
              weight: path.includes(s.id) ? 2 : 1,
            }}
          >
            <Tooltip>
              {s.id} {s.active ? 'active' : 'inactive'}
            </Tooltip>
          </CircleMarker>
        ) : null,
      )}
      {ground.map((g) => (
        <CircleMarker
          key={g.id}
          center={[g.lat_deg, g.lon_deg]}
          radius={7}
          pathOptions={{
            color: g.id === clientId ? '#e85d04' : g.role === 'gateway' ? '#9b2226' : '#001219',
            fillColor: g.role === 'gateway' ? '#ae2012' : '#005f73',
            fillOpacity: 1,
          }}
        >
          <Tooltip>
            {g.id} ({g.role}) — {g.name}
          </Tooltip>
        </CircleMarker>
      ))}
    </MapContainer>
  )
}
