import { useEffect, useState } from 'react'
import type { Scenario } from '../api'

type Props = {
  scenario: Scenario
  onApply: (edits: Record<string, unknown>) => Promise<void>
  onReset: () => Promise<void>
}

export function ConfigPanel({ scenario, onApply, onReset }: Props) {
  const [launchStage, setLaunchStage] = useState(scenario.design.launch_stage)
  const [planes, setPlanes] = useState(scenario.design.planes.map((p) => ({ ...p })))
  const [failures, setFailures] = useState(scenario.failures.map((f) => ({ ...f })))
  const [satId, setSatId] = useState(scenario.design.satellites[0]?.id ?? '')
  const [failStart, setFailStart] = useState(21600)
  const [failEnd, setFailEnd] = useState(86400)
  const [failProb, setFailProb] = useState(scenario.environment.failure_probability ?? 0)

  useEffect(() => {
    setLaunchStage(scenario.design.launch_stage)
    setPlanes(scenario.design.planes.map((p) => ({ ...p })))
    setFailures(scenario.failures.map((f) => ({ ...f })))
    setSatId(scenario.design.satellites[0]?.id ?? '')
    setFailProb(scenario.environment.failure_probability ?? 0)
  }, [scenario])

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
        На каждом шаге каждый активный КА независимо отказывает с этой вероятностью (только на
        этот шаг). 0 — выкл.; прогон становится стохастическим.
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
              environment: { failure_probability: failProb },
            })
          }
        >
          Применить
        </button>
        <button type="button" className="btn ghost" onClick={() => void onReset()}>
          Сброс
        </button>
      </div>
      <p className="muted tiny">
        isl_range={scenario.environment.isl_range_km} км · elev≥
        {scenario.environment.min_elevation_deg}°
      </p>
    </div>
  )
}
