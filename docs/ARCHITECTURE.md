# Архитектура

## Слои

```
React UI  --REST/JSON-->  FastAPI (api/main.py)
                              |
                              +--> store.py (сценарии / варианты / results на FS)
                              |
                              +--> calc/
                                    geometry.py   положения, контакты
                                    routing.py    BFS + причины разрыва
                                    metrics.py    availability / outages
                                    simulation.py прогон по сетке времени
```

## Поток пользовательского сценария

1. Загрузка builtin / upload JSON → `validate()` → сессия `_state["scenario"]`.
2. Правки UI (`launch_stage`, planes, failures) → `apply_edits` → повторная валидация.
3. `POST /api/simulate` → для каждого `t_s` в `[0, horizon)` с шагом `step_s`:
   - `snapshot` (координаты + edges)
   - `find_route` для каждого client
   - агрегация метрик
4. `POST /api/snapshot` отдаёт один момент для карты/3D (ECEF + lat/lon).
5. Сравнение: два сохранённых варианта считаются независимо, UI показывает diff и рекомендацию.

## Где править математику

| Тема | Файл |
|------|------|
| Орбита, ECEF, elevation, ISL | `backend/calc/geometry.py` |
| Выбор маршрута | `backend/calc/routing.py` → `find_route` |
| Причины перерыва | `backend/calc/routing.py` → `classify_outage` |
| Доли / max outage | `backend/calc/metrics.py` |
| Горизонт / экспорт | `backend/calc/simulation.py` |

В этих файлах стоят развёрнутые комментарии к формулам (единицы, инварианты, NOTE для кастомизации). UI и REST при смене модели обычно не трогают.

## Визуализация

`ConstellationViewer` переключает:

- `Map2DView` — Leaflet, lat/lon из snapshot
- `Globe3DView` — R3F, ECEF (`x,z,-y` в Three.js Y-up)

Оба режима читают один и тот же snapshot; переключение не перезапускает расчёт.

## Хранение

- `data/scenarios/` — read-only демо
- `data/variants/{id}.json` — сохранённые проекты
- `data/results/{id}.json` — полный export `cosmo-A-result-1.0`

Сессия API однопользовательская (in-memory). Для жюри/демо на сервере достаточно; при многопользовательском доступе вынесите `_state` в Redis/БД.
