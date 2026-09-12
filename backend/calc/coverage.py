"""
Сетка геометрического покрытия Земли активными КА.

Покрытие ячейки = 1, если max elevation до активного спутника ≥ min_elevation_deg,
иначе 0. Непрерывное значение max_elevation_deg также возвращается для градиента UI.

NOTE: это мгновенный снимок на t_s (не доля времени за горизонт).
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np

from .geometry import R, positions
from .simulation import sticky_failed_up_to


def coverage_grid(
    scenario: dict,
    t_s: float,
    lat_step_deg: float = 2.0,
    lon_step_deg: float = 2.0,
) -> dict[str, Any]:
    """
    Сетка lat × lon.

    Строки: lat от +90 − step/2 вниз к −90 + step/2 (центры ячеек).
    Столбцы: lon от −180 + step/2 до +180 − step/2.
    values[i][j] ∈ [0, 1] — нормализованное покрытие (1 = есть контакт).
    elevation_max_deg[i][j] — максимальный угол возвышения (°), −90 если нет активных КА.
    """
    if not (0.5 <= lat_step_deg <= 30 and 0.5 <= lon_step_deg <= 30):
        raise ValueError("lat_step_deg / lon_step_deg must be in [0.5, 30]")

    e, d = scenario["environment"], scenario["design"]
    min_el = e["min_elevation_deg"]
    ids, _inertial, xyz = positions(scenario, t_s)
    failed = {
        f["satellite_id"] for f in scenario["failures"] if f["start_s"] <= t_s < f["end_s"]
    }
    stochastic = sticky_failed_up_to(scenario, t_s)
    if stochastic:
        failed |= stochastic
    active_mask = np.array(
        [
            sat["launch_batch"] <= d["launch_stage"] and sat["id"] not in failed
            for sat in d["satellites"]
        ]
    )
    active_xyz = xyz[active_mask]

    lats = np.arange(90.0 - lat_step_deg / 2.0, -90.0, -lat_step_deg)
    lons = np.arange(-180.0 + lon_step_deg / 2.0, 180.0, lon_step_deg)
    # защита от накопления float
    lats = lats[lats >= -90.0 + lat_step_deg / 2.0 - 1e-9]
    lons = lons[lons <= 180.0 - lon_step_deg / 2.0 + 1e-9]

    n_lat, n_lon = len(lats), len(lons)
    lat_r = np.radians(lats)[:, None]  # (n_lat, 1)
    lon_r = np.radians(lons)[None, :]  # (1, n_lon)
    # g: (n_lat, n_lon, 3) — broadcast lat/lon в общую сетку
    cos_lat = np.cos(lat_r)
    gx = R * cos_lat * np.cos(lon_r)
    gy = R * cos_lat * np.sin(lon_r)
    gz = R * np.sin(lat_r) * np.ones_like(lon_r)
    g = np.stack((gx, gy, gz), axis=-1)

    if active_xyz.size == 0:
        elev = np.full((n_lat, n_lon), -90.0)
        covered = np.zeros((n_lat, n_lon))
    else:
        # dif: (n_lat, n_lon, n_sat, 3)
        dif = active_xyz[None, None, :, :] - g[:, :, None, :]
        dl = np.linalg.norm(dif, axis=-1)
        # (s-g)·ĝ / ‖s-g‖ , ĝ = g/R
        g_hat = g / R
        sin_el = np.sum(dif * g_hat[:, :, None, :], axis=-1) / np.maximum(dl, 1e-12)
        el = np.degrees(np.arcsin(np.clip(sin_el, -1.0, 1.0)))
        elev = np.max(el, axis=-1)
        covered = (elev >= min_el).astype(float)

    return {
        "t_s": t_s,
        "lat_step_deg": lat_step_deg,
        "lon_step_deg": lon_step_deg,
        "lats": lats.tolist(),
        "lons": lons.tolist(),
        "values": covered.tolist(),
        "elevation_max_deg": elev.tolist(),
        "covered_fraction": float(np.mean(covered)) if covered.size else 0.0,
        "active_satellites": int(np.sum(active_mask)),
    }
