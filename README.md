# ORBIS — проектирование устойчивой спутниковой группировки

Веб-сервис для кейса КосмоХакатон 2026: загрузка сценария `cosmo-A-1.0`, настройка очереди запуска / RAAN / фазирования / отказов, расчёт покрытия и сквозных маршрутов client→gateway, просмотр сети на **плоской карте** и в **3D**, сравнение вариантов и выгрузка результата `cosmo-A-result-1.0`.

## Быстрый старт (локально)

### Требования

- Python 3.11+
- Node.js 20+ (для UI)
- NumPy (ставится из `backend/requirements.txt`)

### Backend

```bash
cd backend
python -m pip install -r requirements.txt
set PYTHONPATH=.
uvicorn api.main:app --reload --host 127.0.0.1 --port 8000
```

(Linux/macOS: `export PYTHONPATH=.`)

API: http://127.0.0.1:8000/docs

### Frontend

```bash
cd frontend
npm install
npm run dev
```

UI: http://127.0.0.1:5173 (прокси `/api` → backend `:8000`)

### Демо-сценарий проверки

1. Откройте UI → «Проект» → **Полная группировка** (`01_full_constellation.json`).
2. «Запустить расчёт» → смотрите метрики и вкладку «Сеть».
3. Переключайте **Плоская карта / 3D**, **BFS / Dijkstra**, двигайте таймлайн; запасные пути — кнопки «осн. / +1».
4. Смените `launch_stage` на 1, сохраните вариант, сравните с полной группировкой.

Встроенные сценарии лежат в `data/scenarios/` (копии из `Задание/Данные`).

## Деплой на сервер (Docker)

```bash
docker compose up --build -d
```

- UI: http://\<server\>:8080  
- API напрямую: http://\<server\>:8000  

Варианты и результаты пишутся в `data/variants` и `data/results` (volume).

Переменные см. `.env.example`.

## Документация для разработки

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — слои и поток данных
- [docs/API.md](docs/API.md) — REST-эндпоинты
- [docs/CALC.md](docs/CALC.md) — формулы ↔ код, куда править математику

## Тесты расчётного слоя

```bash
cd backend
python -m pytest tests/test_calc.py -v
```

Сверка `snapshot` со штатным `Задание/Расчетный модуль/geometry.py`.

## Структура

```
backend/          FastAPI + calc (geometry, routing, metrics, simulation)
frontend/         React + Vite (Leaflet 2D, R3F 3D)
data/scenarios/   демо JSON
data/variants/    сохранённые варианты
data/results/     выгрузки расчётов
docs/
Задание/          исходные материалы хакатона
```
