import { useState } from 'react'
import { Api, type ClientMetrics, type VariantMeta } from '../api'

type Props = {
  variants: VariantMeta[]
  onRefresh: () => Promise<void>
}

function pct(x: number) {
  return `${(x * 100).toFixed(1)}%`
}

export function ComparePanel({ variants, onRefresh }: Props) {
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Awaited<ReturnType<typeof Api.compare>> | null>(null)

  const run = async () => {
    if (!a || !b || a === b) {
      setError('Выберите два разных сохранённых варианта')
      return
    }
    setBusy(true)
    setError(null)
    try {
      setResult(await Api.compare(a, b))
    } catch (e) {
      setError(String((e as Error).message))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card-block compare">
      <h2>Сравнение вариантов</h2>
      <p className="muted">
        Сохраните минимум два варианта на вкладке «Проект», затем сопоставьте доступность и перерывы.
      </p>
      <div className="row wrap">
        <label>
          Вариант A
          <select value={a} onChange={(e) => setA(e.target.value)}>
            <option value="">—</option>
            {variants.map((v) => (
              <option key={v.variant_id} value={v.variant_id}>
                {v.name} ({v.variant_id})
              </option>
            ))}
          </select>
        </label>
        <label>
          Вариант B
          <select value={b} onChange={(e) => setB(e.target.value)}>
            <option value="">—</option>
            {variants.map((v) => (
              <option key={v.variant_id} value={v.variant_id}>
                {v.name} ({v.variant_id})
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn" onClick={() => void run()} disabled={busy}>
          {busy ? 'Считаем оба варианта…' : 'Сравнить'}
        </button>
        <button type="button" className="btn ghost" onClick={() => void onRefresh()}>
          Обновить список
        </button>
      </div>
      {error && <p className="banner error">{error}</p>}
      {result && (
        <div className="compare-result">
          <p className="reco">{result.recommendation.text}</p>
          <p className="muted">
            launch_stage: {JSON.stringify(result.param_diff.launch_stage)} · failures:{' '}
            {JSON.stringify(result.param_diff.failures_count)}
          </p>
          <table className="metrics">
            <thead>
              <tr>
                <th>Пункт</th>
                <th>Avail A</th>
                <th>Avail B</th>
                <th>Outage A</th>
                <th>Outage B</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(result.metrics).map(([id, pair]) => {
                const ma = pair.a as ClientMetrics
                const mb = pair.b as ClientMetrics
                return (
                  <tr key={id}>
                    <td>{id}</td>
                    <td>{ma ? pct(ma.availability_ratio) : '—'}</td>
                    <td>{mb ? pct(mb.availability_ratio) : '—'}</td>
                    <td>{ma ? `${ma.max_outage_s} с` : '—'}</td>
                    <td>{mb ? `${mb.max_outage_s} с` : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
