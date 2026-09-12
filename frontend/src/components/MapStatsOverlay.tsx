type Props = {
  failedSats: number
  activeSats: number
  totalSats: number
  clientsReachable: number
  clientsTotal: number
  gatewaysOnline: number
  gatewaysTotal: number
}

export function MapStatsOverlay({
  failedSats,
  activeSats,
  totalSats,
  clientsReachable,
  clientsTotal,
  gatewaysOnline,
  gatewaysTotal,
}: Props) {
  const groundOnline = clientsReachable + gatewaysOnline
  const groundTotal = clientsTotal + gatewaysTotal
  const groundPct =
    groundTotal > 0 ? Math.round((100 * groundOnline) / groundTotal) : 0

  return (
    <div className="map-stats" onPointerDown={(e) => e.stopPropagation()}>
      <div className="map-legend-title">Статистика</div>
      <div className="map-legend-row">
        отказало КА: <strong>{failedSats}</strong>
      </div>
      <div className="map-legend-row">
        активны КА: <strong>{activeSats}</strong> / {totalSats}
      </div>
      <div className="map-legend-row">
        станции доступны: <strong>{groundOnline}</strong> / {groundTotal} ({groundPct}%)
      </div>
      <div className="map-legend-status">
        клиенты на связи {clientsReachable}/{clientsTotal}
        <br />
        шлюзы online {gatewaysOnline}/{gatewaysTotal}
      </div>
    </div>
  )
}
