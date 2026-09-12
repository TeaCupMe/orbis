"""
Показатели доступности связи по сетке времени.

Доли = число подходящих отсчётов / общее число отсчётов.
Максимальный перерыв = длина самой длинной серии отсчётов без пути × step_s.

NOTE: определение «достижимости» (visibility vs end-to-end) меняйте здесь,
если захотите другую агрегацию для сравнения вариантов.
"""

from __future__ import annotations

from typing import Any


def max_outage_duration_s(reachable: list[bool], step_s: int) -> int:
    """
    Самая длинная непрерывная серия False в reachable, умноженная на step_s.
    Перерывы в начале и конце горизонта учитываются отдельно (как отдельные серии).
    Если перерывов нет — 0.
    """
    max_run = 0
    run = 0
    for ok in reachable:
        if not ok:
            run += 1
            if run > max_run:
                max_run = run
        else:
            run = 0
    return max_run * step_s


def client_metrics_from_reachability(
    visibility: list[bool],
    reachability: list[bool],
    hop_counts: list[int | None],
    step_s: int,
) -> dict[str, Any]:
    """
    Сводка по одному client за весь горизонт.

    visibility[i]  — виден ≥1 активный КА на шаге i
    reachability[i] — есть сквозной путь до gateway
    hop_counts[i]  — число рёбер маршрута или None
    """
    n = len(reachability)
    if n == 0:
        return {
            "visibility_ratio": 0.0,
            "availability_ratio": 0.0,
            "max_outage_s": 0,
            "mean_hops": None,
            "steps": 0,
        }
    vis = sum(1 for v in visibility if v) / n
    avail = sum(1 for r in reachability if r) / n
    hops = [h for h in hop_counts if h is not None]
    mean_hops = (sum(hops) / len(hops)) if hops else None
    return {
        "visibility_ratio": vis,
        "availability_ratio": avail,
        "max_outage_s": max_outage_duration_s(reachability, step_s),
        "mean_hops": mean_hops,
        "steps": n,
    }


def time_grid(horizon_s: int, step_s: int) -> list[int]:
    """
    Отсчёты 0, step, 2·step, …, horizon − step.
    Правый конец горизонта в список не входит (как в «Описании данных»).
    """
    return list(range(0, horizon_s, step_s))
