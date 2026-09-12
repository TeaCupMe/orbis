"""Хранение сценариев, вариантов и результатов на файловой системе."""

from __future__ import annotations

import json
import uuid
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from calc.geometry import validate

ROOT = Path(__file__).resolve().parents[2]
SCENARIOS_DIR = Path(__file__).resolve().parents[2] / "data" / "scenarios"
VARIANTS_DIR = Path(__file__).resolve().parents[2] / "data" / "variants"
RESULTS_DIR = Path(__file__).resolve().parents[2] / "data" / "results"


def _ensure_dirs() -> None:
    VARIANTS_DIR.mkdir(parents=True, exist_ok=True)
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)


def list_builtin_scenarios() -> list[dict[str, str]]:
    items = []
    for path in sorted(SCENARIOS_DIR.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        items.append(
            {
                "id": data.get("meta", {}).get("id", path.stem),
                "title": data.get("meta", {}).get("title", path.stem),
                "filename": path.name,
            }
        )
    return items


def load_builtin(filename: str) -> dict:
    path = SCENARIOS_DIR / filename
    if not path.exists() or path.resolve().parent != SCENARIOS_DIR.resolve():
        raise FileNotFoundError(f"Scenario not found: {filename}")
    data = json.loads(path.read_text(encoding="utf-8"))
    validate(data)
    return data


def parse_and_validate(raw: bytes | str) -> dict:
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8")
    data = json.loads(raw)
    validate(data)
    return data


def apply_edits(scenario: dict, edits: dict[str, Any]) -> dict:
    """
    Применить правки из UI к копии сценария.
    Поддерживаемые поля: design.launch_stage, design.planes[], failures, gateway_outages,
    environment (частично), meta.title.
    """
    s = deepcopy(scenario)
    if "meta" in edits and isinstance(edits["meta"], dict):
        s.setdefault("meta", {}).update(edits["meta"])
    if "environment" in edits and isinstance(edits["environment"], dict):
        for k, v in edits["environment"].items():
            if k in s["environment"]:
                s["environment"][k] = v
    if "design" in edits and isinstance(edits["design"], dict):
        d = edits["design"]
        if "launch_stage" in d:
            s["design"]["launch_stage"] = d["launch_stage"]
        if "planes" in d:
            by_id = {p["id"]: p for p in s["design"]["planes"]}
            for p in d["planes"]:
                if p["id"] in by_id:
                    if "raan_deg" in p:
                        by_id[p["id"]]["raan_deg"] = p["raan_deg"]
                    if "phase_deg" in p:
                        by_id[p["id"]]["phase_deg"] = p["phase_deg"]
    if "failures" in edits:
        s["failures"] = edits["failures"]
    if "gateway_outages" in edits:
        s["gateway_outages"] = edits["gateway_outages"]
    validate(s)
    return s


def save_variant(scenario: dict, name: str | None = None) -> dict:
    _ensure_dirs()
    vid = str(uuid.uuid4())[:8]
    title = name or scenario.get("meta", {}).get("title", "variant")
    payload = {
        "variant_id": vid,
        "name": title,
        "saved_at": datetime.now(timezone.utc).isoformat(),
        "scenario": scenario,
    }
    path = VARIANTS_DIR / f"{vid}.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"variant_id": vid, "name": title, "saved_at": payload["saved_at"]}


def list_variants() -> list[dict]:
    _ensure_dirs()
    out = []
    for path in sorted(VARIANTS_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        data = json.loads(path.read_text(encoding="utf-8"))
        out.append(
            {
                "variant_id": data.get("variant_id", path.stem),
                "name": data.get("name", path.stem),
                "saved_at": data.get("saved_at"),
            }
        )
    return out


def load_variant(variant_id: str) -> dict:
    path = VARIANTS_DIR / f"{variant_id}.json"
    if not path.exists():
        raise FileNotFoundError(variant_id)
    data = json.loads(path.read_text(encoding="utf-8"))
    validate(data["scenario"])
    return data


def delete_variant(variant_id: str) -> None:
    path = VARIANTS_DIR / f"{variant_id}.json"
    if path.exists():
        path.unlink()


def save_result(result: dict, result_id: str | None = None) -> str:
    _ensure_dirs()
    rid = result_id or str(uuid.uuid4())[:8]
    path = RESULTS_DIR / f"{rid}.json"
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return rid


def load_result(result_id: str) -> dict:
    path = RESULTS_DIR / f"{result_id}.json"
    if not path.exists():
        raise FileNotFoundError(result_id)
    return json.loads(path.read_text(encoding="utf-8"))
