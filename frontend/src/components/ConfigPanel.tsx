import { useEffect, useState } from 'react'
import type { GroundSite, Scenario } from '../api'

type Props = {
  scenario: Scenario
  onApply: (edits: Record<string, unknown>) => Promise<void>
  onReset: () => Promise<void>
}

function nextSiteId(sites: GroundSite[], prefix: string): string {
  let n = 1
  const used = new Set(sites.map((s) => s.id))
  while (used.has(`${prefix}${n}`)) n += 1
  return `${prefix}${n}`
}

export function ConfigPanel({ scenario, onApply, onReset }: Props) {
  const [launchStage, setLaunchStage] = useState(scenario.design.launch_stage)
  const [planes, setPlanes] = useState(scenario.design.planes.map((p) => ({ ...p })))
  const [failures, setFailures] = useState(scenario.failures.map((f) => ({ ...f })))
  const [sites, setSites] = useState(scenario.ground_sites.map((g) => ({ ...g })))
  const [satId, setSatId] = useState(scenario.design.satellites[0]?.id ?? '')
  const [failStart, setFailStart] = useState(21600)
  const [failEnd, setFailEnd] = useState(86400)
  const [failProb, setFailProb] = useState(scenario.environment.failure_probability ?? 0)
  const [stepS, setStepS] = useState(scenario.environment.step_s)
  const [islRangeKm, setIslRangeKm] = useState(scenario.environment.isl_range_km)

  useEffect(() => {
    setLaunchStage(scenario.design.launch_stage)
    setPlanes(scenario.design.planes.map((p) => ({ ...p })))
    setFailures(scenario.failures.map((f) => ({ ...f })))
    setSites(scenario.ground_sites.map((g) => ({ ...g })))
    setSatId(scenario.design.satellites[0]?.id ?? '')
    setFailProb(scenario.environment.failure_probability ?? 0)
    setStepS(scenario.environment.step_s)
    setIslRangeKm(scenario.environment.isl_range_km)
  }, [scenario])

  const clientCount = sites.filter((s) => s.role === 'client').length
  const gatewayCount = sites.filter((s) => s.role === 'gateway').length

  const canRemove = (g: GroundSite) => {
    if (g.role === 'client') return clientCount > 1
    if (g.role === 'gateway') return gatewayCount > 1
    return true
  }

  return (
    <div className="card-block">
      <h2>Конфигурация</h2>
      <label>
        Очередь запуска (launch_stage)
        <select value={launchStage} onChange={(e) => setLaunchStage(Number(e.target.value))}>
          <option value={1}>1 — до 16 КА</option>
          <option value={2}>2 — до 32 КА</option>
          <option value={3}>3 — все 48 КА</option>
        </select>
      </label>

      <label>
        Вероятность отказа аппарата (опционально)
        <input
          type="number"
          min={0}
          max={1}
          step={0.01}
          value={failProb}
          onChange={(e) => setFailProb(Number(e.target.value))}
        />
      </label>
      <p className="muted tiny">
        На каждом шаге каждый ещё активный КА может отказать с этой вероятностью и остаётся
        неактивным до конца горизонта. 0 — выкл.
      </p>

      <label>
        Шаг симуляции, с
        <input
          type="number"
          min={1}
          max={scenario.environment.horizon_s}
          step={1}
          value={stepS}
          onChange={(e) => setStepS(Math.max(1, Math.round(Number(e.target.value)) || 1))}
        />
      </label>
      <div className="row wrap">
        {[60, 120, 300, 600, 1800, 3600].map((s) => (
          <button
            key={s}
            type="button"
            className={`btn ghost compact${stepS === s ? ' active-preset' : ''}`}
            disabled={scenario.environment.horizon_s % s !== 0}
            onClick={() => setStepS(s)}
          >
            {s < 60 ? `${s} с` : s % 3600 === 0 ? `${s / 3600} ч` : s % 60 === 0 ? `${s / 60} мин` : `${s} с`}
          </button>
        ))}
      </div>
      <p className="muted tiny">
        Горизонт {scenario.environment.horizon_s} с должен делиться на шаг без остатка. Сейчас шагов:{' '}
        {scenario.environment.horizon_s % stepS === 0
          ? Math.floor(scenario.environment.horizon_s / stepS)
          : '— (не делится)'}
        .
      </p>

      <label>
        Дальность ISL (КА–КА), км
        <input
          type="number"
          min={1}
          max={10000}
          step={50}
          value={islRangeKm}
          onChange={(e) => setIslRangeKm(Number(e.target.value))}
        />
      </label>
      <div className="row wrap">
        {[1500, 2000, 2500, 3000, 4000, 5000].map((km) => (
          <button
            key={km}
            type="button"
            className={`btn ghost compact${islRangeKm === km ? ' active-preset' : ''}`}
            onClick={() => setIslRangeKm(km)}
          >
            {km} км
          </button>
        ))}
      </div>
      <p className="muted tiny">
        Максимальное расстояние межспутниковой связи. Допустимо (0; 10000] км.
      </p>

      <h3>Плоскости</h3>
      {planes.map((p, idx) => (
        <div className="plane-row" key={p.id}>
          <strong>{p.id}</strong>
          <label>
            RAAN°
            <input
              type="number"
              step={0.1}
              min={0}
              max={359.999}
              value={p.raan_deg}
              onChange={(e) => {
                const next = [...planes]
                next[idx] = { ...p, raan_deg: Number(e.target.value) }
                setPlanes(next)
              }}
            />
          </label>
          <label>
            phase°
            <input
              type="number"
              step={0.1}
              min={0}
              max={359.999}
              value={p.phase_deg}
              onChange={(e) => {
                const next = [...planes]
                next[idx] = { ...p, phase_deg: Number(e.target.value) }
                setPlanes(next)
              }}
            />
          </label>
        </div>
      ))}

      <h3>Наземные станции</h3>
      <p className="muted tiny">Нужен ≥1 client и ≥1 gateway. Id должны быть уникальны.</p>
      {sites.map((g, idx) => (
        <div className="site-row" key={`${g.id}-${idx}`}>
          <input
            value={g.id}
            title="id"
            onChange={(e) => {
              const next = [...sites]
              next[idx] = { ...g, id: e.target.value }
              setSites(next)
            }}
          />
          <input
            value={g.name}
            title="name"
            onChange={(e) => {
              const next = [...sites]
              next[idx] = { ...g, name: e.target.value }
              setSites(next)
            }}
          />
          <select
            value={g.role}
            onChange={(e) => {
              const next = [...sites]
              next[idx] = { ...g, role: e.target.value as GroundSite['role'] }
              setSites(next)
            }}
          >
            <option value="client">client</option>
            <option value="gateway">gateway</option>
          </select>
          <input
            type="number"
            step={0.01}
            min={-90}
            max={90}
            value={g.lat_deg}
            title="lat"
            onChange={(e) => {
              const next = [...sites]
              next[idx] = { ...g, lat_deg: Number(e.target.value) }
              setSites(next)
            }}
          />
          <input
            type="number"
            step={0.01}
            min={-180}
            max={180}
            value={g.lon_deg}
            title="lon"
            onChange={(e) => {
              const next = [...sites]
              next[idx] = { ...g, lon_deg: Number(e.target.value) }
              setSites(next)
            }}
          />
          <button
            type="button"
            className="linkish"
            disabled={!canRemove(g)}
            title={
              !canRemove(g) ? 'Нельзя удалить последнего client/gateway' : 'Удалить'
            }
            onClick={() => setSites(sites.filter((_, j) => j !== idx))}
          >
            ×
          </button>
        </div>
      ))}
      <div className="row wrap">
        <button
          type="button"
          className="btn ghost"
          onClick={() =>
            setSites([
              ...sites,
              {
                id: nextSiteId(sites, 'C'),
                name: 'New client',
                role: 'client',
                lat_deg: 70,
                lon_deg: 60,
              },
            ])
          }
        >
          + client
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={() =>
            setSites([
              ...sites,
              {
                id: nextSiteId(sites, 'G'),
                name: 'New gateway',
                role: 'gateway',
                lat_deg: 69,
                lon_deg: 33,
              },
            ])
          }
        >
          + gateway
        </button>
      </div>

      <h3>Отказы спутников</h3>
      <div className="row wrap">
        <select value={satId} onChange={(e) => setSatId(e.target.value)}>
          {scenario.design.satellites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.id}
            </option>
          ))}
        </select>
        <input
          type="number"
          value={failStart}
          onChange={(e) => setFailStart(Number(e.target.value))}
          title="start_s"
        />
        <input
          type="number"
          value={failEnd}
          onChange={(e) => setFailEnd(Number(e.target.value))}
          title="end_s"
        />
        <button
          type="button"
          className="btn ghost"
          onClick={() =>
            setFailures([...failures, { satellite_id: satId, start_s: failStart, end_s: failEnd }])
          }
        >
          Добавить
        </button>
      </div>
      <ul className="failure-list">
        {failures.map((f, i) => (
          <li key={`${f.satellite_id}-${i}`}>
            {f.satellite_id}: [{f.start_s}; {f.end_s})
            <button
              type="button"
              className="linkish"
              onClick={() => setFailures(failures.filter((_, j) => j !== i))}
            >
              удалить
            </button>
          </li>
        ))}
        {!failures.length && <li className="muted">Нет отказов</li>}
      </ul>

      <div className="row">
        <button
          type="button"
          className="btn"
          onClick={() =>
            void onApply({
              design: { launch_stage: launchStage, planes },
              failures,
              ground_sites: sites,
              environment: {
                failure_probability: failProb,
                step_s: stepS,
                isl_range_km: islRangeKm,
              },
            })
          }
        >
          Применить
        </button>
        <button type="button" className="btn ghost" onClick={() => void onReset()}>
          Сброс
        </button>
      </div>
      <p className="muted tiny">elev ≥ {scenario.environment.min_elevation_deg}°</p>
    </div>
  )
}
