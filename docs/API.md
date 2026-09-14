# API

Базовый URL локально: `http://127.0.0.1:8000`.  
Интерактивная схема: `/docs`.

## Сценарии

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/health` | healthcheck |
| GET | `/api/scenarios` | список демо-файлов |
| POST | `/api/scenarios/load/{filename}` | загрузить демо в сессию |
| POST | `/api/scenarios/upload` | multipart `file` — свой JSON |
| GET | `/api/scenario` | текущий сценарий |
| POST | `/api/scenario/edit` | правки `{ design, failures, gateway_outages, ground_sites, environment, meta }` |
| POST | `/api/scenario/reset` | сброс к исходному builtin |
| GET | `/api/scenario/download` | выгрузка текущего JSON |

Ошибки валидации → HTTP 400, `detail` с текстом (поле/объект).

## Варианты

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/variants` | список |
| POST | `/api/variants` | сохранить текущий `{ name? }` |
| GET | `/api/variants/{id}` | содержимое |
| POST | `/api/variants/{id}/load` | загрузить в сессию |
| DELETE | `/api/variants/{id}` | удалить |

## Расчёт

| Метод | Путь | Описание |
|-------|------|----------|
| POST | `/api/simulate` | полный прогон; тело `{ "seed": null\|int, "strategy": "hops"\|"distance" }` опционально; ответ с metrics / availability / series + `result_id` |
| GET | `/api/simulation` | последний compact-результат сессии |
| GET | `/api/results/{id}` | полный `cosmo-A-result-1.0` |
| GET | `/api/results/{id}/download` | attachment |
| POST | `/api/snapshot` | `{ t_s, client_id?, seed?, strategy?, alternate_k? }` → snapshot + routes (+ alternates) + ground_sites |
| POST | `/api/routing/compare` | `{ t_s, client_id, seed? }` → сравнение hops vs distance на снимке |
| POST | `/api/coverage` | `{ t_s, lat_step_deg?, lon_step_deg? }` → теплокарта мгновенного покрытия |
| POST | `/api/compare` | `{ variant_a, variant_b, seed? }` → metrics + param_diff + recommendation |

### Compare (фрагмент ответа)

```json
{
  "variant_a": { "id": "…", "name": "…" },
  "variant_b": { "id": "…", "name": "…" },
  "seed": 0,
  "target_availability": 0.9,
  "param_diff": {
    "launch_stage": { "a": 3, "b": 1 },
    "isl_range_km": { "a": 3000, "b": 2000 },
    "step_s": { "a": 120, "b": 120 },
    "horizon_s": { "a": 86400, "b": 86400 },
    "min_elevation_deg": { "a": 10, "b": 10 },
    "failure_probability": { "a": 0, "b": 0 },
    "failures_count": { "a": 0, "b": 2 },
    "gateway_outages_count": { "a": 0, "b": 0 },
    "ground_sites_count": {
      "a": { "clients": 3, "gateways": 2, "total": 5 },
      "b": { "clients": 3, "gateways": 2, "total": 5 }
    },
    "planes": { "a": {}, "b": {} }
  },
  "metrics": {
    "C65": {
      "a": { "visibility_ratio": 0.9, "availability_ratio": 0.85, "max_outage_s": 1200, "mean_hops": 3.1, "steps": 720 },
      "b": { "visibility_ratio": 0.7, "availability_ratio": 0.6, "max_outage_s": 3600, "mean_hops": 2.8, "steps": 720 }
    }
  },
  "recommendation": {
    "preferred": "a",
    "preferred_name": "…",
    "clients_meeting_target": ["C65"],
    "summary": {
      "mean_availability": { "a": 0.85, "b": 0.6 },
      "max_outage_s": { "a": 1200, "b": 3600 },
      "clients_meeting": { "a": ["C65"], "b": [] }
    },
    "text": "Рекомендуется вариант «…»…"
  },
  "timeline": {
    "a": {
      "times": [0, 120, 240],
      "step_s": 120,
      "horizon_s": 86400,
      "levels": ["full", "partial", "none"],
      "counts": { "full": 1, "partial": 1, "none": 1 }
    },
    "b": { "times": [], "step_s": 120, "horizon_s": 86400, "levels": [], "counts": { "full": 0, "partial": 0, "none": 0 } }
  }
}
```

`timeline.*.levels` на каждом шаге: `full` — маршрут у всех клиентов, `partial` — у части, `none` — ни у кого.

Оба прогона используют один `seed` (по умолчанию `0`), чтобы стохастические отказы были сопоставимы.

### Snapshot (фрагмент ответа)

```json
{
  "t_s": 0,
  "snapshot": {
    "satellites": [{"id":"S01","x_km":...,"y_km":...,"z_km":...,"active":true,"lat_deg":...,"lon_deg":...}],
    "edges": [["S01","S02",1234.5], ["C65","S10",2100.0]],
    "elevation_deg": {"C65": {"S10": 25.1}}
  },
  "routes": {
    "C65": {
      "path": ["C65","S10","S22","G_MUR"],
      "hops": 3,
      "reachable": true,
      "outage_reason": null
    }
  },
  "ground_sites": []
}
```

### Result schema

```json
{
  "schema_version": "cosmo-A-result-1.0",
  "effective_scenario": {},
  "routes": [{"t_s": 0, "client_id": "C65", "path": []}],
  "metrics": {},
  "summary": {
    "target_availability": 0.9,
    "failure_probability": 0.0,
    "random_seed": null
  }
}
```

Опциональное поле сценария `environment.failure_probability` (0…1): на каждом шаге ещё живые активные КА могут необратимо отказать с вероятностью `p` (sticky до конца горизонта). Seed в теле simulate воспроизводит прогон.

### Coverage

```json
{
  "t_s": 0,
  "lat_step_deg": 2,
  "lon_step_deg": 2,
  "lats": [89, 87, "..."],
  "lons": [-179, -177, "..."],
  "values": [[0, 1, 1], "..."],
  "elevation_max_deg": [["..."]],
  "covered_fraction": 0.42,
  "active_satellites": 48
}
```

`values[i][j] = 1`, если в центре ячейки есть ≥1 активный КА с elevation ≥ `min_elevation_deg`.
