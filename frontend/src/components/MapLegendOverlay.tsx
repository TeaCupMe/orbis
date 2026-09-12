type Props = {
  viewLayer: 'network' | 'coverage'
  clientId: string
  selectedSatId: string | null
  satNeighborCount: number
  coverageBusy: boolean
  coverPct: string | null
}

export function MapLegendOverlay({
  viewLayer,
  clientId,
  selectedSatId,
  satNeighborCount,
  coverageBusy,
  coverPct,
}: Props) {
  return (
    <div className="map-legend" onPointerDown={(e) => e.stopPropagation()}>
      {viewLayer === 'network' ? (
        <>
          <div className="map-legend-title">Легенда</div>
          <div className="map-legend-row hint">ЛКМ: клиент — маршрут · КА — ISL и зона связи</div>
          <div className="map-legend-row">
            <span className="dot active-sat" /> активный КА
          </div>
          <div className="map-legend-row">
            <span className="dot inactive-sat" /> неактивный КА
          </div>
          <div className="map-legend-row">
            <span className="dot ground" /> наземный пункт
          </div>
          <div className="map-legend-row">
            <span className="line route" /> маршрут
          </div>
          <div className="map-legend-row">
            <span className="line isl-hi" /> ISL / footprint
          </div>
          <div className="map-legend-status">
            клиент: <strong>{clientId || '—'}</strong>
            {selectedSatId
              ? ` · КА ${selectedSatId} (${satNeighborCount} ISL)`
              : ''}
          </div>
        </>
      ) : (
        <>
          <div className="map-legend-title">Покрытие</div>
          <div className="map-legend-row hint">теплокарта: видимость ≥1 КА</div>
          {coverageBusy && <div className="map-legend-row muted">считаем…</div>}
          {coverPct && <div className="map-legend-status">{coverPct}</div>}
        </>
      )}
    </div>
  )
}
