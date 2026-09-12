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
