"""
Полный прогон сценария по временной сетке: snapshot → маршрут → метрики.

NOTE: узкое место по CPU — snapshot() на каждом шаге (~720 шагов × сутки).
При оптимизации кэшируйте позиции / параллельте шаги, не меняя семантику метрик.
"""

from __future__ import annotations

from typing import Any, Callable

from .geometry import snapshot
from .metrics import client_metrics_from_reachability, time_grid
from .routing import OUTAGE_LABELS_RU, classify_outage, find_route


def _ids(scenario: dict) -> tuple[set[str], set[str], list[str]]:
    sat_ids = {s["id"] for s in scenario["design"]["satellites"]}
    gateways = {g["id"] for g in scenario["ground_sites"] if g["role"] == "gateway"}
    clients = [g["id"] for g in scenario["ground_sites"] if g["role"] == "client"]
    return sat_ids, gateways, clients


def analyze_timestep(
    scenario: dict,
    t_s: float,
    client_id: str | None = None,
) -> dict[str, Any]:
    """Снимок сети + маршруты для всех (или одного) client на момент t_s."""
    sat_ids, gateways, clients = _ids(scenario)
    if client_id is not None:
        clients = [client_id]
    snap = snapshot(scenario, t_s)
    e = scenario["environment"]
    min_el = e["min_elevation_deg"]

    routes: dict[str, Any] = {}
    for cid in clients:
        path = find_route(snap["edges"], cid, gateways, sat_ids)
        elev = snap.get("elevation_deg", {}).get(cid, {})
        visible = any(el >= min_el for el in elev.values())
        reason = None
        reason_label = None
        if path is None:
            reason = classify_outage(snap, cid, gateways, sat_ids, scenario, t_s)
            reason_label = OUTAGE_LABELS_RU.get(reason, reason)
        routes[cid] = {
            "path": path or [],
            "hops": (len(path) - 1) if path else None,
            "visible": visible,
            "reachable": path is not None,
            "outage_reason": reason,
            "outage_reason_label": reason_label,
        }
    return {"t_s": t_s, "snapshot": snap, "routes": routes}


def run_simulation(
    scenario: dict,
    progress: Callable[[float], None] | None = None,
) -> dict[str, Any]:
    """
    Расчёт на всём горизонте.

    Возвращает:
      times          — сетка t_s
      metrics        — сводка по каждому client
      availability   — {client_id: [bool, ...]} сквозная достижимость
      visibility     — {client_id: [bool, ...]}
      routes         — список записей {t_s, client_id, path} (формат выгрузки)
      hop_series     — {client_id: [hops|None, ...]}
      outage_series  — {client_id: [reason|None, ...]}
    """
    e = scenario["environment"]
    step_s = e["step_s"]
    times = time_grid(e["horizon_s"], step_s)
    sat_ids, gateways, clients = _ids(scenario)

    visibility: dict[str, list[bool]] = {c: [] for c in clients}
    reachability: dict[str, list[bool]] = {c: [] for c in clients}
    hop_series: dict[str, list[int | None]] = {c: [] for c in clients}
    outage_series: dict[str, list[str | None]] = {c: [] for c in clients}
    routes_export: list[dict[str, Any]] = []

    n = len(times)
    min_el = e["min_elevation_deg"]

    for i, t_s in enumerate(times):
        snap = snapshot(scenario, float(t_s))
        for cid in clients:
            elev = snap.get("elevation_deg", {}).get(cid, {})
            vis = any(el >= min_el for el in elev.values())
            path = find_route(snap["edges"], cid, gateways, sat_ids)
            visibility[cid].append(vis)
            reachability[cid].append(path is not None)
            hop_series[cid].append((len(path) - 1) if path else None)
            if path is None:
                reason = classify_outage(snap, cid, gateways, sat_ids, scenario, float(t_s))
            else:
                reason = None
            outage_series[cid].append(reason)
            routes_export.append({"t_s": t_s, "client_id": cid, "path": path or []})
        if progress is not None:
            progress((i + 1) / n)

    metrics = {
        cid: client_metrics_from_reachability(
            visibility[cid], reachability[cid], hop_series[cid], step_s
        )
        for cid in clients
    }

    return {
        "times": times,
        "metrics": metrics,
        "availability": reachability,
        "visibility": visibility,
        "routes": routes_export,
        "hop_series": hop_series,
        "outage_series": outage_series,
        "target_availability": e["target_availability"],
        "step_s": step_s,
        "horizon_s": e["horizon_s"],
    }


def build_result_export(scenario: dict, sim: dict[str, Any]) -> dict[str, Any]:
    """Формат выгрузки cosmo-A-result-1.0."""
    return {
        "schema_version": "cosmo-A-result-1.0",
        "effective_scenario": scenario,
        "routes": sim["routes"],
        "metrics": sim["metrics"],
        "summary": {
            "target_availability": sim["target_availability"],
            "step_s": sim["step_s"],
            "horizon_s": sim["horizon_s"],
            "clients_meeting_target": [
                cid
                for cid, m in sim["metrics"].items()
                if m["availability_ratio"] >= sim["target_availability"]
            ],
        },
    }
