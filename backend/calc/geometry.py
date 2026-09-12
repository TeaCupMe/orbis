"""
Геометрия орбит, видимость Земля–КА и межспутниковые линии (ISL).

Формулы соответствуют документу «Описание данных» кейса КосмоХакатон.
NOTE: при изменении модели орбиты / критерия ISL правьте в первую очередь
функции positions(), snapshot() и константы ниже — UI и API трогать не нужно.
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np

# --- Константы модели (км, км³/с², рад/с) ---------------------------------
# Средний радиус сферической Земли, км.
R = 6371.0
# Гравитационный параметр Земли μ, км³/с² → для круговой орбиты n = √(μ/r³).
MU = 398600.435507
# Угловая скорость вращения Земли: 2π / сидерические сутки (86164.09054 с).
# Используется при переходе из инерциальной СК в ECEF (Earth-fixed).
OMEGA = 2 * math.pi / 86164.09054


def load(path: str | Path) -> dict:
    scenario = json.loads(Path(path).read_text(encoding="utf-8"))
    validate(scenario)
    return scenario


def finite(x) -> bool:
    return isinstance(x, (int, float)) and (not isinstance(x, bool)) and math.isfinite(x)


def validate(s: dict) -> None:
    """Проверка входного сценария cosmo-A-1.0; ValueError с указанием сути ошибки."""
    if s.get("schema_version") != "cosmo-A-1.0":
        raise ValueError("Unsupported scenario schema (ожидается schema_version=cosmo-A-1.0)")
    e, d = (s["environment"], s["design"])
    for key in (
        "altitude_km",
        "inclination_deg",
        "earth_angle0_deg",
        "horizon_s",
        "step_s",
        "min_elevation_deg",
        "isl_range_km",
        "target_availability",
    ):
        if key not in e or not finite(e[key]):
            raise ValueError(f"Non-finite or missing environment value: {key}")
    if not (200 <= e["altitude_km"] <= 1200 and 0 < e["inclination_deg"] <= 180):
        raise ValueError("Invalid orbit (altitude_km / inclination_deg)")
    if not isinstance(e["step_s"], int) or not isinstance(e["horizon_s"], int):
        raise ValueError("Time grid must use integer seconds (horizon_s, step_s)")
    if not (0 < e["step_s"] <= e["horizon_s"] <= 172800 and e["horizon_s"] % e["step_s"] == 0):
        raise ValueError("Invalid time grid (horizon_s must be multiple of step_s)")
    if not (
        0 <= e["min_elevation_deg"] < 90
        and 0 < e["isl_range_km"] <= 10000
        and (0 <= e["target_availability"] <= 1)
    ):
        raise ValueError("Invalid link/target values")
    # Опциональное расширение ORBIS: вероятность необратимого отказа КА на шаге
    if "failure_probability" in e:
        fp = e["failure_probability"]
        if not finite(fp) or not (0 <= fp <= 1):
            raise ValueError("failure_probability must be in [0, 1]")
    planes = {p["id"]: p for p in d["planes"]}
    if len(planes) != len(d["planes"]) or not planes:
        raise ValueError("Duplicate/empty planes")
    for p in planes.values():
        if not all((finite(p[k]) and 0 <= p[k] < 360 for k in ("raan_deg", "phase_deg"))):
            raise ValueError(f"Invalid plane angle for plane {p.get('id')}")
    ids = [sat["id"] for sat in d["satellites"]]
    if not ids or len(ids) != len(set(ids)):
        raise ValueError("Duplicate/empty satellite IDs")
    if not isinstance(d["launch_stage"], int) or d["launch_stage"] not in (1, 2, 3):
        raise ValueError("launch_stage must be 1, 2 or 3")
    for sat in d["satellites"]:
        if (
            sat["plane_id"] not in planes
            or sat["launch_batch"] not in (1, 2, 3)
            or (not finite(sat["slot_deg"]))
        ):
            raise ValueError(f"Invalid satellite {sat.get('id')}")
    ground = s["ground_sites"]
    gids = [g["id"] for g in ground]
    if len(gids) != len(set(gids)) or set(gids) & set(ids):
        raise ValueError("Non-unique node IDs (satellites vs ground_sites)")
    if not any((g["role"] == "client" for g in ground)) or not any(
        (g["role"] == "gateway" for g in ground)
    ):
        raise ValueError("Client and gateway required in ground_sites")
    for g in ground:
        if (
            g["role"] not in ("client", "gateway")
            or not finite(g["lat_deg"])
            or (not finite(g["lon_deg"]))
            or (not (-90 <= g["lat_deg"] <= 90 and -180 <= g["lon_deg"] <= 180))
        ):
            raise ValueError(f"Invalid ground site {g.get('id')}")
    gw_ids = {g["id"] for g in ground if g["role"] == "gateway"}
    for field, key, valid in [
        ("failures", "satellite_id", set(ids)),
        ("gateway_outages", "gateway_id", gw_ids),
    ]:
        for f in s.get(field, []):
            if (
                f[key] not in valid
                or not all((finite(f[k]) for k in ("start_s", "end_s")))
                or (not 0 <= f["start_s"] < f["end_s"] <= e["horizon_s"])
            ):
                raise ValueError(f"Invalid outage in {field}: {f}")


def positions(s: dict, t_s: float) -> tuple[list[str], np.ndarray, np.ndarray]:
    """
    Положения всех спутников в момент t_s [с от начала расчёта].

    Возвращает:
      ids       — список id КА
      inertial  — координаты в инерциальной СК модели [км], shape (N, 3)
      fixed     — ECEF / Earth-fixed координаты [км], shape (N, 3)

    Математика (круговая орбита, сферическая Земля):
      r = R + h                         радиус орбиты
      n = √(μ / r³)                     средний движение [рад/с]
      u(t) = slot_deg + phase_deg + n·t аргумент широты (после перевода в рад)
      Ω = raan_deg плоскости, i = inclination_deg

    Инерциальные координаты:
      x = r·(cosΩ·cos u − sinΩ·sin u·cos i)
      y = r·(sinΩ·cos u + cosΩ·sin u·cos i)
      z = r·sin u·sin i

    Поворот Земли θ = earth_angle0 + Ω_earth·t:
      x_e =  cosθ·x + sinθ·y
      y_e = −sinθ·x + cosθ·y
      z_e = z

    NOTE: если нужна другая модель орбиты (эллипс, J2) — меняйте этот блок.
    """
    e, d = (s["environment"], s["design"])
    pmap = {p["id"]: p for p in d["planes"]}

    # Радиус орбиты и среднее движение
    r = R + e["altitude_km"]
    n = math.sqrt(MU / r**3)
    inc = math.radians(e["inclination_deg"])

    # u = (slot + phase плоскости) + n·t ; Ω = RAAN плоскости
    u = np.array(
        [
            math.radians(x["slot_deg"] + pmap[x["plane_id"]]["phase_deg"]) + n * t_s
            for x in d["satellites"]
        ]
    )
    om = np.array([math.radians(pmap[x["plane_id"]]["raan_deg"]) for x in d["satellites"]])
    cu, su, co, so = (np.cos(u), np.sin(u), np.cos(om), np.sin(om))
    ci, si = math.cos(inc), math.sin(inc)

    # Инерциальные координаты (см. формулу выше)
    xyz = r * np.stack(
        (co * cu - so * su * ci, so * cu + co * su * ci, su * si),
        axis=1,
    )

    # Переход в ECEF: поворот вокруг оси z на угол θ(t)
    th = math.radians(e["earth_angle0_deg"]) + OMEGA * t_s
    c, ss = (math.cos(th), math.sin(th))
    # Матрица: [[c, -ss, 0], [ss, c, 0], [0, 0, 1]] применена как xyz @ R^T
    # (эквивалентно документу: x_e = c·x + s·y, y_e = −s·x + c·y)
    fixed = xyz @ np.array([[c, -ss, 0], [ss, c, 0], [0, 0, 1]])
    return ([x["id"] for x in d["satellites"]], xyz, fixed)


def ground_position(g: dict) -> np.ndarray:
    """
    ECEF-координата наземного пункта на сфере радиуса R [км]:
      g = R · (cos φ cos λ, cos φ sin λ, sin φ), φ=lat, λ=lon.
    """
    lat, lon = (math.radians(g["lat_deg"]), math.radians(g["lon_deg"]))
    return R * np.array(
        [math.cos(lat) * math.cos(lon), math.cos(lat) * math.sin(lon), math.sin(lat)]
    )


def ecef_to_lat_lon(x_km: float, y_km: float, z_km: float) -> tuple[float, float]:
    """Обратное преобразование ECEF → (lat_deg, lon_deg) для сферической Земли."""
    lon = math.degrees(math.atan2(y_km, x_km))
    lat = math.degrees(math.atan2(z_km, math.hypot(x_km, y_km)))
    return lat, lon


def snapshot(s: dict, t_s: float, extra_failed: set[str] | None = None) -> dict:
    """
    Состояние сети в момент t_s.

    - satellites: ECEF-координаты + active
    - edges: [id_a, id_b, distance_km] — двунаправленные потенциальные контакты
      (КА–КА и Земля–КА). Наземные узлы НЕ ретранслируют трафик.
    - elevation_deg: углы возвышения активных КА для каждого ground site

    Активность КА:
      active ⇔ launch_batch <= launch_stage
               И нет отказа на [start_s, end_s)
               И id не в extra_failed (накопленные стохастические отказы).

    ISL между активными a, b доступен, если:
      ‖b − a‖ < isl_range_km
      И расстояние от центра Земли до отрезка [a,b] > R
        (линия не пересекает Землю).
      Ближайшая точка: d=b−a, q=clip(−a·d/(d·d), 0, 1), точка = a + q·d.

    Наземный контакт: elevation = arcsin( ((s−g)·ĝ) / ‖s−g‖ ), ĝ = g/R;
      доступен при elevation >= min_elevation_deg и (для gateway) не в outage.

    NOTE: критерии ISL / elevation — типичная точка кастомизации модели.
    """
    e, d = (s["environment"], s["design"])
    ids, _inertial, xyz = positions(s, t_s)

    # Полуинтервал отказа: start включительно, end исключительно
    failed = {
        f["satellite_id"] for f in s["failures"] if f["start_s"] <= t_s < f["end_s"]
    }
    if extra_failed:
        failed |= set(extra_failed)
    active = np.array(
        [
            sat["launch_batch"] <= d["launch_stage"] and sat["id"] not in failed
            for sat in d["satellites"]
        ]
    )

    # --- Межспутниковые линии (все пары i < j) ----------------------------
    i, j = np.triu_indices(len(ids), 1)
    delta = xyz[j] - xyz[i]
    dist = np.linalg.norm(delta, axis=1)
    denom = np.sum(delta * delta, axis=1)
    # Параметр ближайшей точки отрезка к началу координат
    lam = np.clip(-np.sum(xyz[i] * delta, axis=1) / np.maximum(denom, 1e-12), 0, 1)
    closest = np.linalg.norm(xyz[i] + lam[:, None] * delta, axis=1)
    ok = (dist < e["isl_range_km"]) & (closest > R) & active[i] & active[j]
    edges = [[ids[a], ids[b], float(dd)] for a, b, dd in zip(i[ok], j[ok], dist[ok])]

    # --- Контакты Земля–КА ------------------------------------------------
    elevations: dict = {}
    for g in s["ground_sites"]:
        gp = ground_position(g)
        dif = xyz - gp
        dl = np.linalg.norm(dif, axis=1)
        # elevation = arcsin( ((s-g)·ĝ) / ‖s-g‖ ), ĝ = gp/R
        el = np.degrees(np.arcsin(np.clip(dif @ (gp / R) / dl, -1, 1)))
        elevations[g["id"]] = {
            sid: float(el[k]) for k, sid in enumerate(ids) if active[k]
        }
        offline = any(
            f["gateway_id"] == g["id"] and f["start_s"] <= t_s < f["end_s"]
            for f in s["gateway_outages"]
        )
        # Gateway в outage: контакты с ним не добавляются
        vis = (el >= e["min_elevation_deg"]) & active & (not offline)
        edges.extend([[g["id"], ids[k], float(dl[k])] for k in np.where(vis)[0]])

    return {
        "t_s": t_s,
        "satellites": [
            {
                "id": sid,
                "x_km": float(xyz[k, 0]),
                "y_km": float(xyz[k, 1]),
                "z_km": float(xyz[k, 2]),
                "active": bool(active[k]),
            }
            for k, sid in enumerate(ids)
        ],
        "edges": edges,
        "elevation_deg": elevations,
    }


def sunlight(s: dict, t_s: float, sun_eci: list[float]) -> dict[str, bool]:
    """Цилиндрическая тень Земли при фиксированном направлении Солнца (доп. функционал)."""
    ids, xyz, _ = positions(s, t_s)
    sun = np.array(sun_eci, dtype=float)
    sun /= np.linalg.norm(sun)
    projection = xyz @ sun
    perp = np.linalg.norm(xyz - projection[:, None] * sun, axis=1)
    eclipse = (projection < 0) & (perp < R)
    return {sid: not bool(eclipse[k]) for k, sid in enumerate(ids)}


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit("Usage: python geometry.py scenario.json [t_s]")
    scenario = load(sys.argv[1])
    t = float(sys.argv[2]) if len(sys.argv) > 2 else 0
    print(json.dumps(snapshot(scenario, t), ensure_ascii=False, indent=2, allow_nan=False))
