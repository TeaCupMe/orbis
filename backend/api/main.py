"""FastAPI: сценарии, расчёт, snapshot, сравнение, экспорт."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

# backend/ на PYTHONPATH
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from api import store  # noqa: E402
from calc.coverage import coverage_grid  # noqa: E402
from calc.geometry import ecef_to_lat_lon  # noqa: E402
from calc.simulation import analyze_timestep, build_result_export, run_simulation  # noqa: E402

app = FastAPI(title="Constellation Design Service", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory session: текущий сценарий и последний расчёт
_state: dict[str, Any] = {
    "scenario": None,
    "source": None,
    "simulation": None,
    "result_id": None,
}


class EditsBody(BaseModel):
    meta: dict | None = None
    environment: dict | None = None
    design: dict | None = None
    failures: list | None = None
    gateway_outages: list | None = None
    ground_sites: list | None = None


class SaveVariantBody(BaseModel):
    name: str | None = None


class CompareBody(BaseModel):
    variant_a: str
    variant_b: str
    seed: int | None = 0


class SnapshotQuery(BaseModel):
    t_s: float = 0
    client_id: str | None = None


class SimulateBody(BaseModel):
    seed: int | None = None


class CoverageBody(BaseModel):
    t_s: float = 0
    lat_step_deg: float = 2.0
    lon_step_deg: float = 2.0


def _require_scenario() -> dict:
    if _state["scenario"] is None:
        raise HTTPException(400, "Сценарий не загружен")
    return _state["scenario"]


def _enrich_snapshot(snap: dict) -> dict:
    """Добавить lat/lon для 2D-карты."""
    sats = []
    for s in snap["satellites"]:
        lat, lon = ecef_to_lat_lon(s["x_km"], s["y_km"], s["z_km"])
        sats.append({**s, "lat_deg": lat, "lon_deg": lon})
    return {**snap, "satellites": sats}


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/scenarios")
def list_scenarios():
    return store.list_builtin_scenarios()


@app.post("/api/scenarios/load/{filename}")
def load_builtin(filename: str):
    try:
        data = store.load_builtin(filename)
    except FileNotFoundError:
        raise HTTPException(404, f"Файл не найден: {filename}")
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    _state["scenario"] = data
    _state["source"] = filename
    _state["simulation"] = None
    _state["result_id"] = None
    return {"ok": True, "scenario": data, "source": filename}


@app.post("/api/scenarios/upload")
async def upload_scenario(file: UploadFile = File(...)):
    raw = await file.read()
    try:
        data = store.parse_and_validate(raw)
    except json.JSONDecodeError as exc:  # type: ignore[name-defined]
        raise HTTPException(400, f"Некорректный JSON: {exc}")
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        raise HTTPException(400, str(exc))
    _state["scenario"] = data
    _state["source"] = file.filename
    _state["simulation"] = None
    _state["result_id"] = None
    return {"ok": True, "scenario": data, "source": file.filename}


@app.get("/api/scenario")
def get_scenario():
    return {"scenario": _require_scenario(), "source": _state["source"]}


@app.post("/api/scenario/edit")
def edit_scenario(body: EditsBody):
    current = _require_scenario()
    edits = {k: v for k, v in body.model_dump().items() if v is not None}
    try:
        updated = store.apply_edits(current, edits)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    _state["scenario"] = updated
    _state["simulation"] = None
    _state["result_id"] = None
    return {"ok": True, "scenario": updated}


@app.post("/api/scenario/reset")
def reset_scenario():
    src = _state.get("source")
    if not src or not str(src).endswith(".json"):
        raise HTTPException(400, "Нет исходного builtin-сценария для сброса")
    try:
        data = store.load_builtin(str(src))
    except FileNotFoundError:
        raise HTTPException(400, "Сброс доступен только для встроенных сценариев")
    _state["scenario"] = data
    _state["simulation"] = None
    _state["result_id"] = None
    return {"ok": True, "scenario": data}


@app.post("/api/variants")
def save_variant(body: SaveVariantBody):
    sc = _require_scenario()
    meta = store.save_variant(sc, body.name)
    return meta


@app.get("/api/variants")
def list_variants():
    return store.list_variants()


@app.get("/api/variants/{variant_id}")
def get_variant(variant_id: str):
    try:
        data = store.load_variant(variant_id)
    except FileNotFoundError:
        raise HTTPException(404, "Вариант не найден")
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return data


@app.post("/api/variants/{variant_id}/load")
def load_variant_into_session(variant_id: str):
    try:
        data = store.load_variant(variant_id)
    except FileNotFoundError:
        raise HTTPException(404, "Вариант не найден")
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    _state["scenario"] = data["scenario"]
    _state["source"] = f"variant:{variant_id}"
    _state["simulation"] = None
    _state["result_id"] = None
    return {"ok": True, "scenario": data["scenario"], "variant": data}


@app.delete("/api/variants/{variant_id}")
def delete_variant(variant_id: str):
    store.delete_variant(variant_id)
    return {"ok": True}


@app.post("/api/simulate")
def simulate(body: SimulateBody = SimulateBody()):
    sc = _require_scenario()
    seed = body.seed
    sim = run_simulation(sc, seed=seed)
    result = build_result_export(sc, sim)
    rid = store.save_result(result)
    # Компактный ответ для UI (без полного routes dump в теле — он огромный)
    compact = {
        "result_id": rid,
        "metrics": sim["metrics"],
        "times": sim["times"],
        "availability": sim["availability"],
        "visibility": sim["visibility"],
        "hop_series": sim["hop_series"],
        "outage_series": sim["outage_series"],
        "target_availability": sim["target_availability"],
        "step_s": sim["step_s"],
        "horizon_s": sim["horizon_s"],
        "summary": result["summary"],
        "failure_probability": sim.get("failure_probability", 0.0),
        "random_seed": sim.get("random_seed"),
    }
    _state["simulation"] = compact
    _state["result_id"] = rid
    return compact


@app.get("/api/simulation")
def get_simulation():
    if _state["simulation"] is None:
        raise HTTPException(404, "Расчёт ещё не выполнен")
    return _state["simulation"]


@app.get("/api/results/{result_id}")
def get_result(result_id: str):
    try:
        return store.load_result(result_id)
    except FileNotFoundError:
        raise HTTPException(404, "Результат не найден")


@app.get("/api/results/{result_id}/download")
def download_result(result_id: str):
    try:
        data = store.load_result(result_id)
    except FileNotFoundError:
        raise HTTPException(404, "Результат не найден")
    return JSONResponse(
        content=data,
        headers={"Content-Disposition": f'attachment; filename="result_{result_id}.json"'},
    )


@app.get("/api/scenario/download")
def download_scenario():
    sc = _require_scenario()
    return JSONResponse(
        content=sc,
        headers={"Content-Disposition": 'attachment; filename="scenario.json"'},
    )


@app.post("/api/snapshot")
def get_snapshot(body: SnapshotQuery):
    sc = _require_scenario()
    try:
        analysis = analyze_timestep(sc, body.t_s, body.client_id)
    except Exception as exc:
        raise HTTPException(400, str(exc))
    analysis["snapshot"] = _enrich_snapshot(analysis["snapshot"])
    analysis["ground_sites"] = sc["ground_sites"]
    return analysis


@app.post("/api/coverage")
def get_coverage(body: CoverageBody):
    sc = _require_scenario()
    try:
        return coverage_grid(sc, body.t_s, body.lat_step_deg, body.lon_step_deg)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        raise HTTPException(400, str(exc))


@app.post("/api/compare")
def compare(body: CompareBody):
    try:
        a = store.load_variant(body.variant_a)
        b = store.load_variant(body.variant_b)
    except FileNotFoundError as exc:
        raise HTTPException(404, f"Вариант не найден: {exc}")

    seed = body.seed if body.seed is not None else 0
    sim_a = run_simulation(a["scenario"], seed=seed)
    sim_b = run_simulation(b["scenario"], seed=seed)

    def plane_map(sc):
        return {
            p["id"]: {"raan_deg": p["raan_deg"], "phase_deg": p["phase_deg"]}
            for p in sc["design"]["planes"]
        }

    def ground_counts(sc):
        sites = sc.get("ground_sites", [])
        return {
            "clients": sum(1 for g in sites if g.get("role") == "client"),
            "gateways": sum(1 for g in sites if g.get("role") == "gateway"),
            "total": len(sites),
        }

    ea, eb = a["scenario"]["environment"], b["scenario"]["environment"]
    param_diff = {
        "launch_stage": {
            "a": a["scenario"]["design"]["launch_stage"],
            "b": b["scenario"]["design"]["launch_stage"],
        },
        "isl_range_km": {"a": ea["isl_range_km"], "b": eb["isl_range_km"]},
        "step_s": {"a": ea["step_s"], "b": eb["step_s"]},
        "horizon_s": {"a": ea["horizon_s"], "b": eb["horizon_s"]},
        "min_elevation_deg": {
            "a": ea["min_elevation_deg"],
            "b": eb["min_elevation_deg"],
        },
        "failure_probability": {
            "a": float(ea.get("failure_probability") or 0.0),
            "b": float(eb.get("failure_probability") or 0.0),
        },
        "planes": {"a": plane_map(a["scenario"]), "b": plane_map(b["scenario"])},
        "failures_count": {
            "a": len(a["scenario"]["failures"]),
            "b": len(b["scenario"]["failures"]),
        },
        "gateway_outages_count": {
            "a": len(a["scenario"].get("gateway_outages", [])),
            "b": len(b["scenario"].get("gateway_outages", [])),
        },
        "ground_sites_count": {
            "a": ground_counts(a["scenario"]),
            "b": ground_counts(b["scenario"]),
        },
    }

    clients = sorted(set(sim_a["metrics"]) | set(sim_b["metrics"]))
    metrics_cmp = {}
    for cid in clients:
        ma = sim_a["metrics"].get(cid)
        mb = sim_b["metrics"].get(cid)
        metrics_cmp[cid] = {"a": ma, "b": mb}

    target = a["scenario"]["environment"]["target_availability"]
    recommendation = _recommend(a, b, sim_a, sim_b, target)

    return {
        "variant_a": {"id": a["variant_id"], "name": a["name"]},
        "variant_b": {"id": b["variant_id"], "name": b["name"]},
        "param_diff": param_diff,
        "metrics": metrics_cmp,
        "target_availability": target,
        "seed": seed,
        "recommendation": recommendation,
        "timeline": {
            "a": _fleet_availability_timeline(sim_a),
            "b": _fleet_availability_timeline(sim_b),
        },
    }


def _fleet_availability_timeline(sim: dict) -> dict:
    """
    Пошаговый статус по всем клиентам:
      full — маршрут есть у всех клиентов
      partial — у части клиентов
      none — ни у кого
    """
    avail = sim.get("availability") or {}
    times = sim.get("times") or []
    clients = sorted(avail.keys())
    n = len(times)
    levels: list[str] = []
    if not clients or n == 0:
        return {
            "times": times,
            "step_s": sim.get("step_s"),
            "horizon_s": sim.get("horizon_s"),
            "levels": levels,
            "counts": {"full": 0, "partial": 0, "none": 0},
        }

    full = partial = none = 0
    for i in range(n):
        ok = sum(1 for c in clients if i < len(avail[c]) and avail[c][i])
        if ok <= 0:
            levels.append("none")
            none += 1
        elif ok >= len(clients):
            levels.append("full")
            full += 1
        else:
            levels.append("partial")
            partial += 1

    return {
        "times": times,
        "step_s": sim.get("step_s"),
        "horizon_s": sim.get("horizon_s"),
        "levels": levels,
        "counts": {"full": full, "partial": partial, "none": none},
    }


def _recommend(a, b, sim_a, sim_b, target: float) -> dict:
    """Простая текстовая рекомендация по среднему availability и max outage."""

    def score(sim):
        mets = list(sim["metrics"].values())
        if not mets:
            return 0.0, 0
        avail = sum(m["availability_ratio"] for m in mets) / len(mets)
        outage = max(m["max_outage_s"] for m in mets)
        return avail, outage

    def meeting_list(sim):
        return [
            cid
            for cid, m in sim["metrics"].items()
            if m["availability_ratio"] >= target
        ]

    avail_a, out_a = score(sim_a)
    avail_b, out_b = score(sim_b)
    meet_a = meeting_list(sim_a)
    meet_b = meeting_list(sim_b)

    # Лучше выше availability; при равенстве — меньше max outage
    if (avail_a, -out_a) >= (avail_b, -out_b):
        winner, wname, wavail, wout = "a", a["name"], avail_a, out_a
        other_avail, other_out = avail_b, out_b
        meeting = meet_a
        other_meeting_n = len(meet_b)
    else:
        winner, wname, wavail, wout = "b", b["name"], avail_b, out_b
        other_avail, other_out = avail_a, out_a
        meeting = meet_b
        other_meeting_n = len(meet_a)

    text = (
        f"Рекомендуется вариант «{wname}»: средняя доступность {wavail*100:.1f}% "
        f"(у альтернативы {other_avail*100:.1f}%), макс. перерыв {wout} с "
        f"(у альтернативы {other_out} с). "
        f"Цели {target*100:.0f}% достигают {len(meeting)} пунктов "
        f"(у альтернативы {other_meeting_n}): {', '.join(meeting) or 'ни один'}."
    )
    return {
        "preferred": winner,
        "preferred_name": wname,
        "mean_availability": wavail,
        "max_outage_s": wout,
        "clients_meeting_target": meeting,
        "text": text,
        "summary": {
            "mean_availability": {"a": avail_a, "b": avail_b},
            "max_outage_s": {"a": out_a, "b": out_b},
            "clients_meeting": {"a": meet_a, "b": meet_b},
        },
    }


@app.exception_handler(ValueError)
async def value_error_handler(_request, exc: ValueError):
    return JSONResponse(status_code=400, content={"detail": str(exc)})
