"""Расчётный слой: геометрия, маршрутизация, метрики, симуляция."""

from .geometry import load, snapshot, validate
from .metrics import client_metrics_from_reachability
from .routing import classify_outage, find_route
from .simulation import run_simulation

__all__ = [
    "load",
    "validate",
    "snapshot",
    "find_route",
    "classify_outage",
    "client_metrics_from_reachability",
    "run_simulation",
]
