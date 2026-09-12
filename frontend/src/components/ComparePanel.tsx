import { useEffect, useMemo, useState } from 'react'
import {
  Api,
  type ClientMetrics,
  type CompareResult,
  type VariantMeta,
} from '../api'
import { deltaPct, formatSavedAt, formatTime, pct } from '../format'
import { CompareAvailabilityTimeline } from './CompareAvailabilityTimeline'

type Props = {
  variants: VariantMeta[]
  onRefresh: () => Promise<void>
  onLoadVariant: (id: string) => Promise<void>
}

type DiffRow = {
  key: string
  label: string
  a: string
  b: string
  changed: boolean
}

function sideVal(v: unknown): string {
  if (v == null) return '—'
  if (typeof v === 'number') {
    if (!Number.isInteger(v) && Math.abs(v) < 10) return String(v)
    return String(v)
  }
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function buildParamRows(diff: Record<string, unknown>): DiffRow[] {
  const rows: DiffRow[] = []
  const scalarKeys: Array<[string, string]> = [
    ['launch_stage', 'Очередь запуска'],
    ['isl_range_km', 'Дальность ISL, км'],
    ['step_s', 'Шаг симуляции, с'],
    ['horizon_s', 'Горизонт, с'],
    ['min_elevation_deg', 'Мин. elevation, °'],
    ['failure_probability', 'Вероятность отказа'],
    ['failures_count', 'Число отказов КА'],
    ['gateway_outages_count', 'Число outage шлюзов'],
  ]

  for (const [key, label] of scalarKeys) {
    const pair = diff[key] as { a?: unknown; b?: unknown } | undefined
    if (!pair) continue
    const a = sideVal(pair.a)
    const b = sideVal(pair.b)
    rows.push({ key, label, a, b, changed: a !== b })
  }

  const grounds = diff.ground_sites_count as
    | { a?: { clients?: number; gateways?: number; total?: number }; b?: { clients?: number; gateways?: number; total?: number } }
    | undefined
  if (grounds) {
    const a = grounds.a
      ? `${grounds.a.total ?? 0} (клиенты ${grounds.a.clients ?? 0}, шлюзы ${grounds.a.gateways ?? 0})`
      : '—'
    const b = grounds.b
      ? `${grounds.b.total ?? 0} (клиенты ${grounds.b.clients ?? 0}, шлюзы ${grounds.b.gateways ?? 0})`
      : '—'
    rows.push({
      key: 'ground_sites_count',
      label: 'Наземные станции',
      a,
      b,
      changed: a !== b,
    })
  }

  const planes = diff.planes as
    | {
        a?: Record<string, { raan_deg: number; phase_deg: number }>
        b?: Record<string, { raan_deg: number; phase_deg: number }>
      }
    | undefined
  if (planes?.a || planes?.b) {
    const ids = sortedUnique([
      ...Object.keys(planes.a ?? {}),
      ...Object.keys(planes.b ?? {}),
    ])
    for (const id of ids) {
      const pa = planes.a?.[id]
      const pb = planes.b?.[id]
      const a = pa ? `RAAN ${pa.raan_deg}° · phase ${pa.phase_deg}°` : '—'
      const b = pb ? `RAAN ${pb.raan_deg}° · phase ${pb.phase_deg}°` : '—'
      rows.push({
        key: `plane-${id}`,
        label: `Плоскость ${id}`,
        a,
        b,
        changed: a !== b,
      })
    }
  }

  return rows
}

function sortedUnique(xs: string[]) {
  return [...new Set(xs)].sort()
}

function betterClass(
  a: number | null | undefined,
  b: number | null | undefined,
  side: 'a' | 'b',
  mode: 'higher' | 'lower',
) {
  if (a == null || b == null || a === b) return ''
  const aWins = mode === 'higher' ? a > b : a < b
  if (side === 'a') return aWins ? 'cell-win' : 'cell-lose'
  return aWins ? 'cell-lose' : 'cell-win'
}

export function ComparePanel({ variants, onRefresh, onLoadVariant }: Props) {
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [seed, setSeed] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CompareResult | null>(null)

  useEffect(() => {
    if (variants.length >= 2) {
      setA((prev) => prev || variants[0].variant_id)
      setB((prev) => prev || variants[1].variant_id)
    }
  }, [variants])

  const run = async () => {
    if (!a || !b || a === b) {
      setError('Выберите два разных сохранённых варианта')
      return
    }
    setBusy(true)
    setError(null)
    try {
      setResult(await Api.compare(a, b, seed))
    } catch (e) {
      setError(String((e as Error).message))
    } finally {
      setBusy(false)
    }
  }

  const swap = () => {
    setA(b)
    setB(a)
    setResult(null)
  }

  const onDelete = async (id: string) => {
    if (!window.confirm(`Удалить вариант ${id}?`)) return
    setError(null)
    try {
      await Api.deleteVariant(id)
      if (a === id) setA('')
      if (b === id) setB('')
      if (result?.variant_a.id === id || result?.variant_b.id === id) setResult(null)
      await onRefresh()
    } catch (e) {
      setError(String((e as Error).message))
    }
  }

  const downloadJson = () => {
    if (!result) return
    const blob = new Blob([JSON.stringify(result, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const el = document.createElement('a')
    el.href = url
    el.download = `compare-${result.variant_a.id}-${result.variant_b.id}.json`
    el.click()
    URL.revokeObjectURL(url)
  }

  const optionLabel = (v: VariantMeta) => {
    const when = formatSavedAt(v.saved_at)
    return when ? `${v.name} · ${when}` : `${v.name} (${v.variant_id})`
  }

  const paramRows = useMemo(
    () => (result ? buildParamRows(result.param_diff) : []),
    [result],
  )

  const nameA = result?.variant_a.name ?? 'A'
  const nameB = result?.variant_b.name ?? 'B'
  const summary = result?.recommendation.summary
  const target = result?.target_availability ?? 0

  if (variants.length < 2) {
    return (
      <section className="card-block compare">
        <h2>Сравнение вариантов</h2>
        <div className="compare-empty">
          <p>
            Нужно минимум <strong>два сохранённых варианта</strong>.
          </p>
          <p className="muted">
            На вкладке «Проект» настройте сценарий и нажмите «Сохранить вариант», затем
            повторите с другими параметрами (очередь запуска, ISL, отказы…).
          </p>
          <button type="button" className="btn ghost" onClick={() => void onRefresh()}>
            Обновить список
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="card-block compare">
      <h2>Сравнение вариантов</h2>
      <p className="muted">
        Сопоставьте доступность, перерывы и параметры дизайна двух сохранённых вариантов.
      </p>

      <div className="row wrap compare-controls">
        <label>
          Вариант A
          <select value={a} onChange={(e) => setA(e.target.value)} disabled={busy}>
            <option value="">—</option>
            {variants.map((v) => (
              <option key={v.variant_id} value={v.variant_id}>
                {optionLabel(v)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Вариант B
          <select value={b} onChange={(e) => setB(e.target.value)} disabled={busy}>
            <option value="">—</option>
            {variants.map((v) => (
              <option key={v.variant_id} value={v.variant_id}>
                {optionLabel(v)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Seed
          <input
            type="number"
            value={seed}
            disabled={busy}
            onChange={(e) => setSeed(Math.round(Number(e.target.value)) || 0)}
            title="Общий seed для стохастических отказов"
          />
        </label>
        <button type="button" className="btn ghost" onClick={swap} disabled={busy || !a || !b}>
          A ↔ B
        </button>
        <button type="button" className="btn" onClick={() => void run()} disabled={busy}>
          {busy ? 'Считаем оба варианта…' : 'Сравнить'}
        </button>
        <button type="button" className="btn ghost" onClick={() => void onRefresh()} disabled={busy}>
          Обновить список
        </button>
      </div>

      <div className="compare-variants">
        <h3>Сохранённые варианты</h3>
        <ul className="variant-list compare-variant-list">
          {variants.map((v) => (
            <li key={v.variant_id}>
              <div className="compare-variant-meta">
                <strong>{v.name}</strong>
                <span className="muted">
                  {v.variant_id}
                  {v.saved_at ? ` · ${formatSavedAt(v.saved_at)}` : ''}
                </span>
              </div>
              <div className="row">
                <button
                  type="button"
                  className="btn ghost compact"
                  disabled={busy}
                  onClick={() => void onLoadVariant(v.variant_id)}
                >
                  В Проект
                </button>
                <button
                  type="button"
                  className="btn ghost compact"
                  disabled={busy}
                  onClick={() => void onDelete(v.variant_id)}
                >
                  Удалить
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {error && <p className="banner error">{error}</p>}

      {result && summary && (
        <div className="compare-result">
          <div className={`compare-reco preferred-${result.recommendation.preferred}`}>
            <div className="compare-reco-badge">Рекомендация</div>
            <p className="reco">{result.recommendation.text}</p>
            <div className="compare-reco-meta">
              <span>
                Победитель: <strong>{result.recommendation.preferred_name}</strong>
              </span>
              <span>Цель: {pct(target)}</span>
              <span>Seed: {result.seed}</span>
            </div>
            <p className="muted tiny">
              Клиенты у цели ({nameA}):{' '}
              {summary.clients_meeting.a.join(', ') || '—'}
              <br />
              Клиенты у цели ({nameB}):{' '}
              {summary.clients_meeting.b.join(', ') || '—'}
            </p>
          </div>

          <div className="compare-bars">
            <h3>Средняя доступность</h3>
            <div className="compare-bar-row">
              <span className="compare-bar-label">{nameA}</span>
              <div className="compare-bar-track">
                <div
                  className="compare-bar-fill a"
                  style={{ width: `${summary.mean_availability.a * 100}%` }}
                />
              </div>
              <span className="compare-bar-value">{pct(summary.mean_availability.a)}</span>
            </div>
            <div className="compare-bar-row">
              <span className="compare-bar-label">{nameB}</span>
              <div className="compare-bar-track">
                <div
                  className="compare-bar-fill b"
                  style={{ width: `${summary.mean_availability.b * 100}%` }}
                />
              </div>
              <span className="compare-bar-value">{pct(summary.mean_availability.b)}</span>
            </div>
            <p className="muted tiny">
              Макс. перерыв: {nameA} {formatTime(summary.max_outage_s.a)} · {nameB}{' '}
              {formatTime(summary.max_outage_s.b)}
            </p>
          </div>

          {result.timeline && (
            <div className="compare-timelines">
              <h3>Таймлайн доступности флота</h3>
              <p className="muted tiny compare-timeline-legend">
                <span className="legend-swatch legend-full" /> полный доступ (все клиенты)
                <span className="legend-swatch legend-partial" /> частичный
                <span className="legend-swatch legend-none" /> нет доступа
              </p>
              <CompareAvailabilityTimeline label={nameA} timeline={result.timeline.a} />
              <CompareAvailabilityTimeline label={nameB} timeline={result.timeline.b} />
            </div>
          )}

          <div className="compare-section-head">
            <h3>Метрики по клиентам</h3>
            <button type="button" className="btn ghost compact" onClick={downloadJson}>
              Скачать JSON
            </button>
          </div>
          <div className="table-scroll">
            <table className="metrics compare-metrics">
              <thead>
                <tr>
                  <th>Пункт</th>
                  <th>Avail {nameA}</th>
                  <th>Avail {nameB}</th>
                  <th>Δ</th>
                  <th>Vis {nameA}</th>
                  <th>Vis {nameB}</th>
                  <th>Outage {nameA}</th>
                  <th>Outage {nameB}</th>
                  <th>Hops {nameA}</th>
                  <th>Hops {nameB}</th>
                  <th>Цель {nameA}</th>
                  <th>Цель {nameB}</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(result.metrics).map(([id, pair]) => {
                  const ma = pair.a as ClientMetrics | null
                  const mb = pair.b as ClientMetrics | null
                  return (
                    <tr key={id}>
                      <td>{id}</td>
                      <td className={betterClass(ma?.availability_ratio, mb?.availability_ratio, 'a', 'higher')}>
                        {ma ? pct(ma.availability_ratio) : '—'}
                      </td>
                      <td className={betterClass(ma?.availability_ratio, mb?.availability_ratio, 'b', 'higher')}>
                        {mb ? pct(mb.availability_ratio) : '—'}
                      </td>
                      <td>
                        {ma && mb
                          ? deltaPct(ma.availability_ratio, mb.availability_ratio)
                          : '—'}
                      </td>
                      <td className={betterClass(ma?.visibility_ratio, mb?.visibility_ratio, 'a', 'higher')}>
                        {ma ? pct(ma.visibility_ratio) : '—'}
                      </td>
                      <td className={betterClass(ma?.visibility_ratio, mb?.visibility_ratio, 'b', 'higher')}>
                        {mb ? pct(mb.visibility_ratio) : '—'}
                      </td>
                      <td className={betterClass(ma?.max_outage_s, mb?.max_outage_s, 'a', 'lower')}>
                        {ma ? formatTime(ma.max_outage_s) : '—'}
                      </td>
                      <td className={betterClass(ma?.max_outage_s, mb?.max_outage_s, 'b', 'lower')}>
                        {mb ? formatTime(mb.max_outage_s) : '—'}
                      </td>
                      <td>{ma?.mean_hops != null ? ma.mean_hops.toFixed(2) : '—'}</td>
                      <td>{mb?.mean_hops != null ? mb.mean_hops.toFixed(2) : '—'}</td>
                      <td>{ma ? (ma.availability_ratio >= target ? 'да' : 'нет') : '—'}</td>
                      <td>{mb ? (mb.availability_ratio >= target ? 'да' : 'нет') : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <h3>Различия параметров</h3>
          <div className="table-scroll">
            <table className="metrics compare-diff">
              <thead>
                <tr>
                  <th>Параметр</th>
                  <th>{nameA}</th>
                  <th>{nameB}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {paramRows.map((row) => (
                  <tr key={row.key} className={row.changed ? 'row-changed' : ''}>
                    <td>{row.label}</td>
                    <td>{row.a}</td>
                    <td>{row.b}</td>
                    <td>{row.changed ? '≠' : '='}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  )
}
