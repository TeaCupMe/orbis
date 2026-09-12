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
| POST | `/api/simulate` | полный прогон; тело `{ "seed": null\|int }` опционально; ответ с metrics / availability / series + `result_id` |
| GET | `/api/simulation` | последний compact-результат сессии |
| GET | `/api/results/{id}` | полный `cosmo-A-result-1.0` |
| GET | `/api/results/{id}/download` | attachment |
| POST | `/api/snapshot` | `{ t_s, client_id? }` → snapshot + routes + ground_sites |
| POST | `/api/coverage` | `{ t_s, lat_step_deg?, lon_step_deg? }` → теплокарта мгновенного покрытия |
| POST | `/api/compare` | `{ variant_a, variant_b }` → metrics diff + recommendation |

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

Опциональное поле сценария `environment.failure_probability` (0…1): на каждом шаге независимый Bernoulli-отказ активных КА. Seed в теле simulate воспроизводит прогон.

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
