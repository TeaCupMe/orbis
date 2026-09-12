import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Api,
  type Scenario,
  type Simulation,
  type SnapshotAnalysis,
  type VariantMeta,
} from './api'
import { ConstellationViewer } from './components/ConstellationViewer'
import { AvailabilityChart } from './components/AvailabilityChart'
import { ComparePanel } from './components/ComparePanel'
import { ConfigPanel } from './components/ConfigPanel'
import { formatTime, pct } from './format'

type Tab = 'project' | 'network' | 'compare'

export default function App() {
  const [tab, setTab] = useState<Tab>('project')
  const [scenarios, setScenarios] = useState<Array<{ id: string; title: string; filename: string }>>([])
  const [scenario, setScenario] = useState<Scenario | null>(null)
  const [source, setSource] = useState<string | null>(null)
  const [sim, setSim] = useState<Simulation | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [t_s, setTs] = useState(0)
  const [clientId, setClientId] = useState<string>('')
  const [analysis, setAnalysis] = useState<SnapshotAnalysis | null>(null)
  const [variants, setVariants] = useState<VariantMeta[]>([])
  const [variantName, setVariantName] = useState('')
  const [playing, setPlaying] = useState(false)

  const clients = useMemo(
    () => scenario?.ground_sites.filter((g) => g.role === 'client') ?? [],
    [scenario],
  )

  const refreshVariants = useCallback(async () => {
    try {
      setVariants(await Api.listVariants())
    } catch {
      /* empty */
    }
  }, [])

  useEffect(() => {
    Api.listScenarios()
      .then(setScenarios)
      .catch((e) => setError(String(e.message ?? e)))
    refreshVariants()
  }, [refreshVariants])

  useEffect(() => {
    if (clients.length && !clientId) setClientId(clients[0].id)
  }, [clients, clientId])

  useEffect(() => {
    if (tab !== 'network') setPlaying(false)
  }, [tab])

  const loadBuiltin = async (filename: string) => {
    setBusy(true)
    setError(null)
    setPlaying(false)
    try {
      const res = await Api.loadBuiltin(filename)
      setScenario(res.scenario)
      setSource(res.source)
      setSim(null)
      setAnalysis(null)
      setTs(0)
      setTab('project')
    } catch (e) {
      setError(String((e as Error).message))
    } finally {
      setBusy(false)
    }
  }

  const onUpload = async (file: File) => {
    setBusy(true)
    setError(null)
    setPlaying(false)
    try {
      const res = await Api.upload(file)
      setScenario(res.scenario)
      setSource(res.source)
      setSim(null)
      setAnalysis(null)
      setTs(0)
    } catch (e) {
      setError(String((e as Error).message))
    } finally {
      setBusy(false)
    }
  }

  const runSim = async () => {
    if (!scenario) return
    setBusy(true)
    setError(null)
    setPlaying(false)
    try {
      const res = await Api.simulate()
      setSim(res)
      setTab('network')
      const snap = await Api.snapshot(0)
      setTs(0)
      setAnalysis(snap)
    } catch (e) {
      setError(String((e as Error).message))
    } finally {
      setBusy(false)
    }
  }

  const onTimeChange = useCallback(
    async (next: number) => {
      setTs(next)
      if (!scenario) return
      try {
        const snap = await Api.snapshot(next)
        setAnalysis(snap)
      } catch (e) {
        setError(String((e as Error).message))
        setPlaying(false)
      }
    },
    [scenario],
  )

  const onClientChange = useCallback((cid: string) => {
    setClientId(cid)
  }, [])

  const ensureNetworkShown = async () => {
    if (analysis) return
    await onTimeChange(0)
  }

  useEffect(() => {
    if (tab === 'network' && scenario && !analysis) {
      void ensureNetworkShown()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, scenario])

  const saveVariant = async () => {
    setBusy(true)
    setError(null)
    try {
      await Api.saveVariant(variantName || scenario?.meta.title)
      setVariantName('')
      await refreshVariants()
    } catch (e) {
      setError(String((e as Error).message))
    } finally {
      setBusy(false)
    }
  }

  const routeInfo = clientId && analysis ? analysis.routes[clientId] : null
  const routeLabel = routeInfo
    ? routeInfo.reachable
      ? `${routeInfo.path.join(' → ')} · hops ${routeInfo.hops}`
      : routeInfo.outage_reason_label ?? 'перерыв связи'
    : 'загрузка…'

  return (
    <div className={`app ${tab === 'network' ? 'app-network' : ''}`}>
      <header className="topbar">
        <div className="brand">
          <div className="brand-lockup" aria-label="ORBIS">
            <img className="brand-logo" src="/Logo_Blue.svg" alt="" width={40} height={40} />
            <div className="brand-text">
              <div className="brand-title-row">
                <span className="brand-mark">Orbis</span>
                <span className="brand-dot" aria-hidden>
                  ·
                </span>
                <img
                  className="brand-team"
                  src="/Title_BlackYellow.svg"
                  alt="название команды"
                  height={22}
                />
              </div>
              <span className="brand-sub">проектирование устойчивой группировки</span>
            </div>
          </div>
        </div>
        <nav className="tabs">
          {(
            [
              ['project', 'Проект'],
              ['network', 'Сеть'],
              ['compare', 'Сравнение'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              className={tab === id ? 'tab active' : 'tab'}
              onClick={() => setTab(id)}
              type="button"
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="top-actions">
          <span className={`busy${busy ? ' is-on' : ''}`} aria-live="polite">
            {busy ? 'Считаем…' : ''}
          </span>
          {scenario && (
            <>
              <button type="button" className="btn ghost" onClick={runSim} disabled={busy}>
                Запустить расчёт
              </button>
              {sim && (
                <a className="btn ghost" href={Api.downloadResultUrl(sim.result_id)} download>
                  Выгрузить результат
                </a>
              )}
              <a className="btn ghost" href={Api.downloadScenarioUrl()} download>
                Сценарий JSON
              </a>
            </>
          )}
        </div>
      </header>

      {error && (
        <div className="banner error" role="alert">
          {error}
          <button type="button" onClick={() => setError(null)}>
            ×
          </button>
        </div>
      )}

      <main className={`main ${tab === 'network' ? 'main-network' : ''}`}>
        {tab === 'project' && (
          <section className="panel-grid">
            <div className="card-block">
              <h2>Сценарий</h2>
              <p className="muted">Загрузите демо или свой JSON формата cosmo-A-1.0</p>
              <div className="scenario-list">
                {scenarios.map((s) => (
                  <button
                    key={s.filename}
                    type="button"
                    className={source === s.filename ? 'scenario active' : 'scenario'}
                    onClick={() => loadBuiltin(s.filename)}
                  >
                    <strong>{s.title}</strong>
                    <span>{s.filename}</span>
                  </button>
                ))}
              </div>
              <label className="file-btn">
                Загрузить файл
                <input
                  type="file"
                  accept="application/json,.json"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) void onUpload(f)
                  }}
                />
              </label>
              {scenario && (
                <div className="meta-line">
                  <span>{scenario.meta.title}</span>
                  <span className="muted">{source}</span>
                </div>
              )}
            </div>

            {scenario && (
              <ConfigPanel
                scenario={scenario}
                onApply={async (edits) => {
                  setBusy(true)
                  setError(null)
                  try {
                    const res = await Api.edit(edits)
                    setScenario(res.scenario)
                    setSim(null)
                    const nextClients = res.scenario.ground_sites.filter((g) => g.role === 'client')
                    if (!nextClients.some((c) => c.id === clientId)) {
                      setClientId(nextClients[0]?.id ?? '')
                    }
                    setAnalysis(null)
                    setTs(0)
                    setPlaying(false)
                  } catch (e) {
                    setError(String((e as Error).message))
                  } finally {
                    setBusy(false)
                  }
                }}
                onReset={async () => {
                  try {
                    const res = await Api.reset()
                    setScenario(res.scenario)
                    setSim(null)
                  } catch (e) {
                    setError(String((e as Error).message))
                  }
                }}
              />
            )}

            <div className="card-block">
              <h2>Сохранение варианта</h2>
              <div className="row">
                <input
                  value={variantName}
                  onChange={(e) => setVariantName(e.target.value)}
                  placeholder="Название варианта"
                />
                <button type="button" className="btn" onClick={saveVariant} disabled={!scenario || busy}>
                  Сохранить
                </button>
              </div>
              <ul className="variant-list">
                {variants.map((v) => (
                  <li key={v.variant_id}>
                    <button
                      type="button"
                      onClick={async () => {
                        const res = await Api.loadVariant(v.variant_id)
                        setScenario(res.scenario)
                        setSource(`variant:${v.variant_id}`)
                        setSim(null)
                      }}
                    >
                      {v.name}
                    </button>
                    <span className="muted">{v.variant_id}</span>
                  </li>
                ))}
              </ul>
            </div>

            {sim && (
              <div className="card-block span-2">
                <h2>Показатели доступности</h2>
                <p className="muted">
                  Цель: {pct(sim.target_availability)} · горизонт {formatTime(sim.horizon_s)} · шаг{' '}
                  {sim.step_s} с
                </p>
                <table className="metrics">
                  <thead>
                    <tr>
                      <th>Пункт</th>
                      <th>Видимость</th>
                      <th>Доступность</th>
                      <th>Макс. перерыв</th>
                      <th>Ср. hops</th>
                      <th>Цель</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(sim.metrics).map(([id, m]) => (
                      <tr key={id}>
                        <td>{id}</td>
                        <td>{pct(m.visibility_ratio)}</td>
                        <td>{pct(m.availability_ratio)}</td>
                        <td>{formatTime(m.max_outage_s)}</td>
                        <td>{m.mean_hops?.toFixed(2) ?? '—'}</td>
                        <td>
                          {m.availability_ratio >= sim.target_availability ? 'да' : 'нет'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <AvailabilityChart simulation={sim} clientId={clientId || clients[0]?.id} />
              </div>
            )}
          </section>
        )}

        {tab === 'network' && scenario && analysis && (
          <section className="network">
            <ConstellationViewer
              analysis={analysis}
              clientId={clientId}
              path={routeInfo?.path ?? []}
              t_s={t_s}
              step_s={scenario.environment.step_s}
              horizon_s={scenario.environment.horizon_s}
              minElevationDeg={scenario.environment.min_elevation_deg}
              gatewayOutages={scenario.gateway_outages}
              simulation={sim}
              playing={playing}
              onPlayingChange={setPlaying}
              onTimeChange={(t) => void onTimeChange(t)}
              onSelectClient={onClientChange}
              routeLabel={routeLabel}
            />
          </section>
        )}

        {tab === 'network' && scenario && !analysis && (
          <p className="muted pad">Загрузка сети…</p>
        )}

        {tab === 'network' && !scenario && (
          <p className="muted pad">Сначала загрузите сценарий на вкладке «Проект».</p>
        )}

        {tab === 'compare' && (
          <ComparePanel
            variants={variants}
            onRefresh={refreshVariants}
            onLoadVariant={async (id) => {
              setBusy(true)
              setError(null)
              try {
                const res = await Api.loadVariant(id)
                setScenario(res.scenario)
                setSource(`variant:${id}`)
                setSim(null)
                setAnalysis(null)
                setPlaying(false)
                setTab('project')
              } catch (e) {
                setError(String((e as Error).message))
              } finally {
                setBusy(false)
              }
            }}
          />
        )}
      </main>
    </div>
  )
}
