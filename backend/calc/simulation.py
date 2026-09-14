"""
Полный прогон сценария по временной сетке: snapshot → маршрут → метрики.

NOTE: узкое место по CPU — snapshot() на каждом шаге (~720 шагов × сутки).
При оптимизации кэшируйте позиции / параллельте шаги, не меняя семантику метрик.
"""

from __future__ import annotations

from typing import Any, Callable

import numpy as np

from .geometry import snapshot
from .metrics import client_metrics_from_reachability, time_grid
from .routing import (
    OUTAGE_LABELS_RU,
    RoutingStrategy,
    classify_outage,
    find_alternate_routes,
    find_route,
    path_length_km,
)


def _ids(scenario: dict) -> tuple[set[str], set[str], list[str]]:
    sat_ids = {s["id"] for s in scenario["design"]["satellites"]}
    gateways = {g["id"] for g in scenario["ground_sites"] if g["role"] == "gateway"}
    clients = [g["id"] for g in scenario["ground_sites"] if g["role"] == "client"]
    return sat_ids, gateways, clients


def _normalize_strategy(strategy: str | None) -> RoutingStrategy:
    if strategy == "distance":
        return "distance"
    return "hops"


def _roll_new_failures(
    scenario: dict,
    t_s: float,
    p: float,
    rng: np.random.Generator,
    already_failed: set[str],
) -> set[str]:
    """
    Bernoulli-отказы на шаге t_s среди КА, которые ещё не отказали стохастически
    и иначе были бы активны (launch_batch ≤ launch_stage, нет детерминированного failure).

    Возвращает только *новые* отказы; already_failed не трогает.
    """
    if p <= 0:
        return set()
    d = scenario["design"]
    det = {
        f["satellite_id"] for f in scenario["failures"] if f["start_s"] <= t_s < f["end_s"]
    }
    out: set[str] = set()
    for sat in d["satellites"]:
        sid = sat["id"]
        if sid in already_failed:
            continue
        if sat["launch_batch"] > d["launch_stage"] or sid in det:
            continue
        if rng.random() < p:
            out.add(sid)
    return out


def _step_rng(base_seed: int | None, t_s: float) -> np.random.Generator:
    """Детерминированный RNG на шаг: один и тот же t_s → те же броски."""
    ss = np.random.SeedSequence([int(base_seed or 0), int(round(float(t_s)))])
    return np.random.default_rng(ss)


def sticky_failed_up_to(
    scenario: dict,
    t_s: float,
    seed: int | None = None,
) -> set[str] | None:
    """
    Накопленные стохастические отказы к моменту t_s (включительно по сетке).

    На каждом шаге ≤ t_s ещё живые КА могут отказать с вероятностью p;
    отказавший остаётся в множестве до конца горизонта.
    """
    p = float(scenario["environment"].get("failure_probability") or 0.0)
    if p <= 0:
        return None
    e = scenario["environment"]
    sticky: set[str] = set()
    for t in time_grid(e["horizon_s"], e["step_s"]):
        if float(t) > float(t_s) + 1e-9:
            break
        sticky |= _roll_new_failures(
            scenario, float(t), p, _step_rng(seed, float(t)), sticky
        )
    return sticky


def analyze_timestep(
    scenario: dict,
    t_s: float,
    client_id: str | None = None,
    seed: int | None = None,
    strategy: str | None = "hops",
    alternate_k: int = 3,
) -> dict[str, Any]:
    """Снимок сети + маршруты для всех (или одного) client на момент t_s."""
    sat_ids, gateways, clients = _ids(scenario)
    if client_id is not None:
        clients = [client_id]
    strat = _normalize_strategy(strategy)
    extra = sticky_failed_up_to(scenario, t_s, seed)
    snap = snapshot(scenario, t_s, extra_failed=extra)
    e = scenario["environment"]
    min_el = e["min_elevation_deg"]

    routes: dict[str, Any] = {}
    for cid in clients:
        alts = find_alternate_routes(
            snap["edges"], cid, gateways, sat_ids, strategy=strat, k=alternate_k
        )
        path = alts[0]["path"] if alts else None
        elev = snap.get("elevation_deg", {}).get(cid, {})
        visible = any(el >= min_el for el in elev.values())
        reason = None
        reason_label = None
        if not path:
            reason = classify_outage(snap, cid, gateways, sat_ids, scenario, t_s)
            reason_label = OUTAGE_LABELS_RU.get(reason, reason)
        # Сравнение стратегий на этом снимке (для UI)
        other: RoutingStrategy = "distance" if strat == "hops" else "hops"
        other_path = find_route(snap["edges"], cid, gateways, sat_ids, strategy=other)
        routes[cid] = {
            "path": path or [],
            "hops": (len(path) - 1) if path else None,
            "length_km": path_length_km(snap["edges"], path) if path else None,
            "strategy": strat,
            "visible": visible,
            "reachable": bool(path),
            "outage_reason": reason,
            "outage_reason_label": reason_label,
            "alternates": alts,
            "alternate_count": len(alts),
            "other_strategy": {
                "strategy": other,
                "path": other_path or [],
                "hops": (len(other_path) - 1) if other_path else None,
                "length_km": (
                    path_length_km(snap["edges"], other_path) if other_path else None
                ),
                "reachable": other_path is not None,
            },
        }
    return {
        "t_s": t_s,
        "snapshot": snap,
        "routes": routes,
        "routing_strategy": strat,
        "stochastic_failed": sorted(extra) if extra else [],
        "active_satellites": sum(1 for s in snap["satellites"] if s["active"]),
        "inactive_satellites": sum(1 for s in snap["satellites"] if not s["active"]),
    }


def run_simulation(
    scenario: dict,
    progress: Callable[[float], None] | None = None,
    seed: int | None = None,
    strategy: str | None = "hops",
) -> dict[str, Any]:
    """
    Расчёт на всём горизонте.

    Если environment.failure_probability > 0 — на каждом шаге ещё активные КА
    могут отказать с вероятностью p; отказ необратим до конца прогона (sticky).
    seed воспроизводит прогон (см. _step_rng / sticky_failed_up_to).
    strategy: hops (BFS) или distance (Dijkstra) — влияет на выбранный путь
    и mean_hops / mean_path_km, но не на availability (достижимость та же).
    """
    e = scenario["environment"]
    step_s = e["step_s"]
    times = time_grid(e["horizon_s"], step_s)
    sat_ids, gateways, clients = _ids(scenario)
    p = float(e.get("failure_probability") or 0.0)
    strat = _normalize_strategy(strategy)

    visibility: dict[str, list[bool]] = {c: [] for c in clients}
    reachability: dict[str, list[bool]] = {c: [] for c in clients}
    hop_series: dict[str, list[int | None]] = {c: [] for c in clients}
    path_km_series: dict[str, list[float | None]] = {c: [] for c in clients}
    outage_series: dict[str, list[str | None]] = {c: [] for c in clients}
    routes_export: list[dict[str, Any]] = []

    n = len(times)
    min_el = e["min_elevation_deg"]
    sticky: set[str] = set()

    for i, t_s in enumerate(times):
        if p > 0:
            sticky |= _roll_new_failures(
                scenario, float(t_s), p, _step_rng(seed, float(t_s)), sticky
            )
            extra: set[str] | None = set(sticky)
        else:
            extra = None
        snap = snapshot(scenario, float(t_s), extra_failed=extra)
        for cid in clients:
            elev = snap.get("elevation_deg", {}).get(cid, {})
            vis = any(el >= min_el for el in elev.values())
            path = find_route(snap["edges"], cid, gateways, sat_ids, strategy=strat)
            visibility[cid].append(vis)
            reachability[cid].append(path is not None)
            hop_series[cid].append((len(path) - 1) if path else None)
            path_km_series[cid].append(
                path_length_km(snap["edges"], path) if path else None
            )
            if path is None:
                reason = classify_outage(snap, cid, gateways, sat_ids, scenario, float(t_s))
            else:
                reason = None
            outage_series[cid].append(reason)
            routes_export.append(
                {
                    "t_s": t_s,
                    "client_id": cid,
                    "path": path or [],
                    "strategy": strat,
                }
            )
        if progress is not None:
            progress((i + 1) / n)

    metrics = {}
    for cid in clients:
        m = client_metrics_from_reachability(
            visibility[cid], reachability[cid], hop_series[cid], step_s
        )
        lengths = [x for x in path_km_series[cid] if x is not None]
        m["mean_path_km"] = (sum(lengths) / len(lengths)) if lengths else None
        metrics[cid] = m

    return {
        "times": times,
        "metrics": metrics,
        "availability": reachability,
        "visibility": visibility,
        "routes": routes_export,
        "hop_series": hop_series,
        "path_km_series": path_km_series,
        "outage_series": outage_series,
        "target_availability": e["target_availability"],
        "step_s": step_s,
        "horizon_s": e["horizon_s"],
        "failure_probability": p,
        "random_seed": seed if p > 0 else None,
        "routing_strategy": strat,
    }


def build_result_export(scenario: dict, sim: dict[str, Any]) -> dict[str, Any]:
    """Формат выгрузки cosmo-A-result-1.0."""
    summary = {
        "target_availability": sim["target_availability"],
        "step_s": sim["step_s"],
        "horizon_s": sim["horizon_s"],
        "clients_meeting_target": [
            cid
            for cid, m in sim["metrics"].items()
            if m["availability_ratio"] >= sim["target_availability"]
        ],
        "failure_probability": sim.get("failure_probability", 0.0),
        "routing_strategy": sim.get("routing_strategy", "hops"),
    }
    if sim.get("random_seed") is not None:
        summary["random_seed"] = sim["random_seed"]
    return {
        "schema_version": "cosmo-A-result-1.0",
        "effective_scenario": scenario,
        "routes": sim["routes"],
        "metrics": sim["metrics"],
        "summary": summary,
    }
