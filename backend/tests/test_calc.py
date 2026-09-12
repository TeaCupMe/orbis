"""Сверка geometry/snapshot со штатным модулем из Задание/Расчетный модуль."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))

from calc.geometry import load, positions, snapshot  # noqa: E402
from calc.metrics import max_outage_duration_s  # noqa: E402
from calc.routing import find_route  # noqa: E402
from calc.simulation import run_simulation  # noqa: E402


def _load_reference():
    path = ROOT / "Задание" / "Расчетный модуль" / "geometry.py"
    spec = importlib.util.spec_from_file_location("ref_geometry", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


REF = _load_reference()
SCENARIO = ROOT / "data" / "scenarios" / "01_full_constellation.json"


def test_snapshot_matches_reference_t0():
    ours = load(SCENARIO)
    ref_s = REF.load(SCENARIO)
    a = snapshot(ours, 0)
    b = REF.snapshot(ref_s, 0)
    assert a["t_s"] == b["t_s"]
    assert len(a["satellites"]) == len(b["satellites"])
    for sa, sb in zip(a["satellites"], b["satellites"]):
        assert sa["id"] == sb["id"]
        assert sa["active"] == sb["active"]
        assert abs(sa["x_km"] - sb["x_km"]) < 1e-6
        assert abs(sa["y_km"] - sb["y_km"]) < 1e-6
        assert abs(sa["z_km"] - sb["z_km"]) < 1e-6
    # edges as sets of frozensets (order of endpoints may differ)
    def edge_set(edges):
        return {frozenset((e[0], e[1])) for e in edges}

    assert edge_set(a["edges"]) == edge_set(b["edges"])


def test_positions_midday():
    s = load(SCENARIO)
    ids_a, _, fix_a = positions(s, 43200)
    ids_b, _, fix_b = REF.positions(s, 43200)
    assert ids_a == ids_b
    assert np.allclose(fix_a, fix_b, atol=1e-6)


def test_bfs_route_simple():
    edges = [
        ["C1", "S1", 1000],
        ["S1", "S2", 500],
        ["S2", "G1", 800],
    ]
    path = find_route(edges, "C1", {"G1"}, {"S1", "S2"})
    assert path == ["C1", "S1", "S2", "G1"]


def test_bfs_no_route():
    edges = [["C1", "S1", 1000], ["S2", "G1", 800]]
    path = find_route(edges, "C1", {"G1"}, {"S1", "S2"})
    assert path is None


def test_max_outage():
    # F F T F F F T → max run 3 → 3 * 120 = 360
    assert max_outage_duration_s([False, False, True, False, False, False, True], 120) == 360
    assert max_outage_duration_s([True, True, True], 120) == 0


def test_short_horizon_simulation():
    s = load(SCENARIO)
    s["environment"]["horizon_s"] = 1200  # 10 steps
    s["environment"]["step_s"] = 120
    sim = run_simulation(s)
    assert len(sim["times"]) == 10
    assert set(sim["metrics"].keys()) == {"C65", "C70", "C72"}
    for m in sim["metrics"].values():
        assert 0 <= m["availability_ratio"] <= 1
        assert m["steps"] == 10


def test_failure_probability_one_kills_links():
    s = load(SCENARIO)
    s["environment"]["horizon_s"] = 1200
    s["environment"]["step_s"] = 120
    s["environment"]["failure_probability"] = 1.0
    sim = run_simulation(s, seed=0)
    for m in sim["metrics"].values():
        assert m["availability_ratio"] == 0.0
        assert m["visibility_ratio"] == 0.0


def test_snapshot_respects_failure_probability():
    from calc.simulation import analyze_timestep

    s = load(SCENARIO)
    s["environment"]["failure_probability"] = 1.0
    analysis = analyze_timestep(s, 0.0, seed=0)
    active = [sat for sat in analysis["snapshot"]["satellites"] if sat["active"]]
    assert len(active) == 0
    assert len(analysis["stochastic_failed"]) == len(s["design"]["satellites"])


def test_sticky_failures_accumulate():
    from calc.simulation import analyze_timestep

    s = load(SCENARIO)
    s["environment"]["horizon_s"] = 1200
    s["environment"]["step_s"] = 120
    s["environment"]["failure_probability"] = 0.35
    early = analyze_timestep(s, 0.0, seed=7)
    late = analyze_timestep(s, 1080.0, seed=7)
    failed_early = {sat["id"] for sat in early["snapshot"]["satellites"] if not sat["active"]}
    failed_late = {sat["id"] for sat in late["snapshot"]["satellites"] if not sat["active"]}
    assert failed_early <= failed_late
    assert len(failed_late) >= len(failed_early)


def test_failure_probability_zero_matches_baseline():
    s = load(SCENARIO)
    s["environment"]["horizon_s"] = 1200
    s["environment"]["step_s"] = 120
    base = run_simulation(s)
    s2 = load(SCENARIO)
    s2["environment"]["horizon_s"] = 1200
    s2["environment"]["step_s"] = 120
    s2["environment"]["failure_probability"] = 0.0
    with_p = run_simulation(s2, seed=42)
    assert base["availability"] == with_p["availability"]


def test_coverage_grid_inactive_zero():
    from calc.coverage import coverage_grid

    s = load(SCENARIO)
    s["design"]["launch_stage"] = 1
    # force all sats inactive via failures covering whole horizon
    s["failures"] = [
        {"satellite_id": sat["id"], "start_s": 0, "end_s": s["environment"]["horizon_s"]}
        for sat in s["design"]["satellites"]
    ]
    grid = coverage_grid(s, 0.0, lat_step_deg=5.0, lon_step_deg=5.0)
    assert grid["active_satellites"] == 0
    assert grid["covered_fraction"] == 0.0
    assert all(v == 0 for row in grid["values"] for v in row)


def test_coverage_grid_full_has_north():
    from calc.coverage import coverage_grid

    s = load(SCENARIO)
    grid = coverage_grid(s, 0.0, lat_step_deg=5.0, lon_step_deg=5.0)
    assert grid["active_satellites"] == 48
    assert grid["covered_fraction"] > 0
    # northern band: first few rows (high lat)
    north = grid["values"][:6]
    assert any(v > 0 for row in north for v in row)
