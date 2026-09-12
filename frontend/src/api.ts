export type GroundSite = {
  id: string
  name: string
  role: 'client' | 'gateway'
  lat_deg: number
  lon_deg: number
}

export type Plane = {
  id: string
  raan_deg: number
  phase_deg: number
}

export type Scenario = {
  schema_version: string
  meta: { id: string; title: string }
  environment: {
    altitude_km: number
    inclination_deg: number
    earth_angle0_deg: number
    horizon_s: number
    step_s: number
    min_elevation_deg: number
    isl_range_km: number
    target_availability: number
    /** Опционально: вероятность необратимого отказа КА на шаге [0..1] */
    failure_probability?: number
  }
  design: {
    launch_stage: number
    planes: Plane[]
    satellites: Array<{
      id: string
      plane_id: string
      slot_deg: number
      launch_batch: number
    }>
  }
  ground_sites: GroundSite[]
  failures: Array<{ satellite_id: string; start_s: number; end_s: number }>
  gateway_outages: Array<{ gateway_id: string; start_s: number; end_s: number }>
}

export type ClientMetrics = {
  visibility_ratio: number
  availability_ratio: number
  max_outage_s: number
  mean_hops: number | null
  steps: number
}

export type Simulation = {
  result_id: string
  metrics: Record<string, ClientMetrics>
  times: number[]
  availability: Record<string, boolean[]>
  visibility: Record<string, boolean[]>
  hop_series: Record<string, Array<number | null>>
  outage_series: Record<string, Array<string | null>>
  target_availability: number
  step_s: number
  horizon_s: number
  summary: {
    target_availability: number
    step_s: number
    horizon_s: number
    clients_meeting_target: string[]
  }
}

export type SatelliteState = {
  id: string
  x_km: number
  y_km: number
  z_km: number
  active: boolean
  lat_deg?: number
  lon_deg?: number
}

export type SnapshotAnalysis = {
  t_s: number
  snapshot: {
    t_s: number
    satellites: SatelliteState[]
    edges: Array<[string, string, number]>
    elevation_deg: Record<string, Record<string, number>>
  }
  routes: Record<
    string,
    {
      path: string[]
      hops: number | null
      visible: boolean
      reachable: boolean
      outage_reason: string | null
      outage_reason_label: string | null
    }
  >
  ground_sites: GroundSite[]
  stochastic_failed?: string[]
  active_satellites?: number
  inactive_satellites?: number
}

export type CoverageGrid = {
  t_s: number
  lat_step_deg: number
  lon_step_deg: number
  lats: number[]
  lons: number[]
  values: number[][]
  elevation_max_deg: number[][]
  covered_fraction: number
  active_satellites: number
}

export type VariantMeta = {
  variant_id: string
  name: string
  saved_at?: string
}

export type CompareSide = { a: number; b: number }

export type CompareFleetTimeline = {
  times: number[]
  step_s: number
  horizon_s: number
  levels: Array<'full' | 'partial' | 'none'>
  counts: { full: number; partial: number; none: number }
}

export type CompareResult = {
  variant_a: { id: string; name: string }
  variant_b: { id: string; name: string }
  param_diff: Record<string, unknown>
  metrics: Record<string, { a: ClientMetrics | null; b: ClientMetrics | null }>
  target_availability: number
  seed: number
  recommendation: {
    preferred: 'a' | 'b'
    preferred_name: string
    mean_availability: number
    max_outage_s: number
    clients_meeting_target: string[]
    text: string
    summary: {
      mean_availability: CompareSide
      max_outage_s: CompareSide
      clients_meeting: { a: string[]; b: string[] }
    }
  }
  timeline: {
    a: CompareFleetTimeline
    b: CompareFleetTimeline
  }
}

const BASE = import.meta.env.VITE_API_BASE ?? ''

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init)
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = await res.json()
      detail = body.detail ?? JSON.stringify(body)
    } catch {
      /* ignore */
    }
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail))
  }
  return res.json() as Promise<T>
}

export const Api = {
  listScenarios: () =>
    api<Array<{ id: string; title: string; filename: string }>>('/api/scenarios'),
  loadBuiltin: (filename: string) =>
    api<{ ok: boolean; scenario: Scenario; source: string }>(
      `/api/scenarios/load/${encodeURIComponent(filename)}`,
      { method: 'POST' },
    ),
  upload: async (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return api<{ ok: boolean; scenario: Scenario; source: string }>('/api/scenarios/upload', {
      method: 'POST',
      body: fd,
    })
  },
  getScenario: () => api<{ scenario: Scenario; source: string | null }>('/api/scenario'),
  edit: (edits: Record<string, unknown>) =>
    api<{ ok: boolean; scenario: Scenario }>('/api/scenario/edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(edits),
    }),
  reset: () => api<{ ok: boolean; scenario: Scenario }>('/api/scenario/reset', { method: 'POST' }),
  simulate: (seed?: number | null) =>
    api<Simulation>('/api/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seed: seed ?? null }),
    }),
  getSimulation: () => api<Simulation>('/api/simulation'),
  snapshot: (t_s: number, client_id?: string) =>
    api<SnapshotAnalysis>('/api/snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ t_s, client_id: client_id ?? null }),
    }),
  coverage: (t_s: number, lat_step_deg = 2, lon_step_deg = 2) =>
    api<CoverageGrid>('/api/coverage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ t_s, lat_step_deg, lon_step_deg }),
    }),
  saveVariant: (name?: string) =>
    api<VariantMeta>('/api/variants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }),
  listVariants: () => api<VariantMeta[]>('/api/variants'),
  loadVariant: (id: string) =>
    api<{ ok: boolean; scenario: Scenario }>(`/api/variants/${id}/load`, { method: 'POST' }),
  deleteVariant: (id: string) =>
    api<{ ok: boolean }>(`/api/variants/${id}`, { method: 'DELETE' }),
  compare: (variant_a: string, variant_b: string, seed: number | null = 0) =>
    api<CompareResult>('/api/compare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variant_a, variant_b, seed }),
    }),
  downloadResultUrl: (id: string) => `${BASE}/api/results/${id}/download`,
  downloadScenarioUrl: () => `${BASE}/api/scenario/download`,
}
