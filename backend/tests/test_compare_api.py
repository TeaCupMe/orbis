"""API-level smoke for /api/compare enrichment."""

from __future__ import annotations

import copy
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from calc.geometry import load

ROOT = Path(__file__).resolve().parents[2]
SCENARIO = ROOT / "data" / "scenarios" / "01_full_constellation.json"


@pytest.fixture()
def client(tmp_path, monkeypatch):
    from api import store
    from api.main import app, _state

    monkeypatch.setattr(store, "VARIANTS_DIR", tmp_path / "variants")
    monkeypatch.setattr(store, "RESULTS_DIR", tmp_path / "results")
    store._ensure_dirs()

    sc = load(SCENARIO)
    sc["environment"]["horizon_s"] = 600
    sc["environment"]["step_s"] = 120
    _state["scenario"] = sc
    _state["source"] = "test"
    _state["simulation"] = None
    _state["result_id"] = None

    return TestClient(app)


def test_compare_returns_summary_and_seed(client):
    a = client.post("/api/variants", json={"name": "A"}).json()
    sc = copy.deepcopy(client.get("/api/scenario").json()["scenario"])
    sc["design"]["launch_stage"] = 1
    sc["environment"]["isl_range_km"] = 2000.0
    # apply via edit on session then save B
    client.post(
        "/api/scenario/edit",
        json={
            "design": {"launch_stage": 1},
            "environment": {"isl_range_km": 2000.0},
        },
    )
    b = client.post("/api/variants", json={"name": "B"}).json()

    res = client.post(
        "/api/compare",
        json={"variant_a": a["variant_id"], "variant_b": b["variant_id"], "seed": 7},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["seed"] == 7
    assert "summary" in body["recommendation"]
    assert "mean_availability" in body["recommendation"]["summary"]
    assert "step_s" in body["param_diff"]
    assert "failure_probability" in body["param_diff"]
    assert "ground_sites_count" in body["param_diff"]
    assert body["param_diff"]["launch_stage"]["a"] != body["param_diff"]["launch_stage"]["b"]
    assert body["param_diff"]["isl_range_km"]["b"] == 2000.0
    assert "timeline" in body
    assert set(body["timeline"]["a"]["levels"]) <= {"full", "partial", "none"}
    assert len(body["timeline"]["a"]["levels"]) == len(body["timeline"]["a"]["times"])
    assert "counts" in body["timeline"]["a"]
