# Расчётная модель

Источник формул: «Описание данных» кейса. Референс-реализация организаторов: `Задание/Расчетный модуль/geometry.py`.

Рабочая копия с комментариями: `backend/calc/geometry.py`.

## Константы

| Символ | Значение | Код |
|--------|----------|-----|
| R | 6371 км | `R` |
| μ | 398600.435507 км³/с² | `MU` |
| Ω_earth | 2π / 86164.09054 рад/с | `OMEGA` |

## Положения КА — `positions()`

1. `r = R + altitude_km`, `n = √(μ/r³)`
2. `u = rad(slot_deg + phase_deg) + n·t`
3. `Ω = rad(raan_deg)`, `i = rad(inclination_deg)`
4. Инерциальные x,y,z (см. комментарии в коде)
5. ECEF: поворот на `θ = rad(earth_angle0_deg) + Ω_earth·t`

Недоступный КА **сохраняет** координаты, но `active=false` и не входит в edges.

## Контакты — `snapshot()`

**ISL:** `‖b−a‖ < isl_range_km` и расстояние от центра Земли до отрезка `[a,b] > R`.

**Земля–КА:**  
`elevation = arcsin(((s−g)·ĝ) / ‖s−g‖)`, порог `min_elevation_deg`.  
Для gateway дополнительно учитывается `gateway_outages` на полуинтервале `[start_s, end_s)`.

## Маршрутизация — `find_route()`

BFS по числу рёбер. Промежуточные узлы — только спутники.  
Число hops = `len(path) - 1` (включая две наземные линии).

Причины отсутствия пути (`classify_outage`):

- `no_visible_satellite`
- `isl_partition`
- `no_gateway_contact`
- `gateway_unavailable`

## Метрики — `metrics.py` / `simulation.py`

Сетка: `0, step_s, …, horizon_s - step_s`.

- visibility_ratio = доля шагов с ≥1 видимым активным КА
- availability_ratio = доля шагов со сквозным путём
- max_outage_s = макс. серия шагов без пути × `step_s`

## Стохастические отказы — `failure_probability`

Опциональное расширение ORBIS (не обязательное поле cosmo-A-1.0):

- `environment.failure_probability` ∈ `[0, 1]`, по умолчанию отсутствует / `0`.
- На **каждом** шаге сетки для каждого КА, который иначе активен (`launch_batch ≤ launch_stage` и нет детерминированного `failures`), независимо с вероятностью `p` КА помечается отказавшим **только на этот шаг** (Bernoulli).
- Реализуется через `snapshot(..., extra_failed=...)` внутри `run_simulation`.
- `POST /api/simulate` принимает `{ "seed": <int|null> }` — при `p > 0` seed воспроизводит броски; без seed — недетерминированный прогон.
- В `summary` результата пишутся `failure_probability` и `random_seed` (если задан).

Детерминированные интервалы `failures` имеют приоритет и не «перебрасываются».

## Теплокарта покрытия — `coverage.py`

Мгновенный снимок на `t_s` (не доля за сутки):

- Сетка центров ячеек с шагом `lat_step_deg` / `lon_step_deg` (по умолчанию 2°).
- Для каждой ячейки: ECEF как у `ground_position`, max elevation до активных КА.
- `values = 1`, если max elevation ≥ `min_elevation_deg`, иначе `0`.
- `covered_fraction` — доля ячеек с покрытием.
- Эндпоинт: `POST /api/coverage`.

## Как проверить после правок

```bash
cd backend
python -m pytest tests/test_calc.py -v
```

`test_snapshot_matches_reference_t0` сравнивает ваш `snapshot` со штатным на `t=0` для `01_full_constellation.json`. Если вы **намеренно** меняете модель, обновите/ослабьте этот тест и опишите отличие в презентации.

## CLI референса организаторов

```bash
python "Задание/Расчетный модуль/geometry.py" "data/scenarios/01_full_constellation.json" 0
```
