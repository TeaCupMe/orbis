"""
Маршрутизация client → спутники → gateway по снимку сети.

Стратегии:
  hops     — BFS, минимум числа рёбер (по умолчанию)
  distance — Dijkstra, минимум суммарной длины рёбер (км)

Дополнительно: запасные (node-disjoint) пути и сравнение стратегий
на одном снимке. classify_outage не зависит от стратегии.
"""

from __future__ import annotations

import heapq
from collections import defaultdict, deque
from typing import Any, Literal

RoutingStrategy = Literal["hops", "distance"]
STRATEGIES: tuple[RoutingStrategy, ...] = ("hops", "distance")


def build_adjacency(edges: list[list]) -> dict[str, list[tuple[str, float]]]:
    """Неориентированный граф из списка [id_a, id_b, distance_km]."""
    adj: dict[str, list[tuple[str, float]]] = defaultdict(list)
    for a, b, dist in edges:
        adj[a].append((b, float(dist)))
        adj[b].append((a, float(dist)))
    return adj


def _edge_allowed(
    node: str,
    nxt: str,
    gateway_ids: set[str],
    satellite_ids: set[str],
    blocked: set[str],
) -> bool:
    """Правила расширения: client→sat|gw, sat→sat|gw; промежуточные — только КА."""
    if nxt in blocked:
        return False
    if node in gateway_ids and node not in satellite_ids:
        return False
    if node not in gateway_ids and node not in satellite_ids:
        # client (или иной ground): только на КА или gateway
        return nxt in satellite_ids or nxt in gateway_ids
    if node in satellite_ids:
        return nxt in satellite_ids or nxt in gateway_ids
    return False


def _reconstruct(parent: dict[str, str | None], found: str) -> list[str]:
    path: list[str] = []
    cur: str | None = found
    while cur is not None:
        path.append(cur)
        cur = parent[cur]
    path.reverse()
    return path


def path_length_km(edges: list[list], path: list[str]) -> float | None:
    """Сумма distance_km по рёбрам пути; None если ребра нет в графе."""
    if len(path) < 2:
        return 0.0 if path else None
    dist_map: dict[frozenset[str], float] = {}
    for a, b, d in edges:
        dist_map[frozenset((a, b))] = float(d)
    total = 0.0
    for i in range(len(path) - 1):
        key = frozenset((path[i], path[i + 1]))
        if key not in dist_map:
            return None
        total += dist_map[key]
    return total


def find_route_hops(
    edges: list[list],
    client_id: str,
    gateway_ids: set[str],
    satellite_ids: set[str],
    *,
    blocked: set[str] | None = None,
) -> list[str] | None:
    """Кратчайший путь по числу hops (BFS)."""
    if not gateway_ids:
        return None
    blocked = blocked or set()
    adj = build_adjacency(edges)
    if client_id not in adj:
        return None

    parent: dict[str, str | None] = {client_id: None}
    queue: deque[str] = deque([client_id])
    found: str | None = None
    while queue:
        node = queue.popleft()
        if node in gateway_ids and node != client_id:
            found = node
            break
        for nxt, _dist in adj[node]:
            if nxt in parent:
                continue
            if not _edge_allowed(node, nxt, gateway_ids, satellite_ids, blocked):
                continue
            parent[nxt] = node
            queue.append(nxt)

    if found is None:
        return None
    return _reconstruct(parent, found)


def find_route_distance(
    edges: list[list],
    client_id: str,
    gateway_ids: set[str],
    satellite_ids: set[str],
    *,
    blocked: set[str] | None = None,
) -> list[str] | None:
    """Кратчайший путь по суммарной длине рёбер, км (Dijkstra)."""
    if not gateway_ids:
        return None
    blocked = blocked or set()
    adj = build_adjacency(edges)
    if client_id not in adj:
        return None

    dist: dict[str, float] = {client_id: 0.0}
    parent: dict[str, str | None] = {client_id: None}
    heap: list[tuple[float, str]] = [(0.0, client_id)]
    found: str | None = None
    found_d = float("inf")

    while heap:
        d, node = heapq.heappop(heap)
        if d > dist.get(node, float("inf")):
            continue
        if node in gateway_ids and node != client_id:
            found = node
            found_d = d
            break
        for nxt, w in adj[node]:
            if not _edge_allowed(node, nxt, gateway_ids, satellite_ids, blocked):
                continue
            nd = d + w
            if nd < dist.get(nxt, float("inf")):
                dist[nxt] = nd
                parent[nxt] = node
                heapq.heappush(heap, (nd, nxt))

    if found is None or found_d == float("inf"):
        return None
    return _reconstruct(parent, found)


def find_route(
    edges: list[list],
    client_id: str,
    gateway_ids: set[str],
    satellite_ids: set[str],
    strategy: RoutingStrategy = "hops",
    *,
    blocked: set[str] | None = None,
) -> list[str] | None:
    """
    Допустимый путь client → … → gateway.

    Ограничения модели:
    - промежуточные узлы — только спутники;
    - путь обязан начинаться в client_id и заканчиваться в одном из gateway_ids;
    - рёбра client–gateway напрямую допустимы, если есть в edges.
    """
    if strategy == "distance":
        return find_route_distance(
            edges, client_id, gateway_ids, satellite_ids, blocked=blocked
        )
    return find_route_hops(
        edges, client_id, gateway_ids, satellite_ids, blocked=blocked
    )


def route_meta(
    edges: list[list],
    path: list[str] | None,
    strategy: RoutingStrategy,
) -> dict[str, Any]:
    """Метрики одного маршрута для UI/API."""
    if not path:
        return {
            "path": [],
            "hops": None,
            "length_km": None,
            "strategy": strategy,
        }
    return {
        "path": path,
        "hops": len(path) - 1,
        "length_km": path_length_km(edges, path),
        "strategy": strategy,
    }


def find_alternate_routes(
    edges: list[list],
    client_id: str,
    gateway_ids: set[str],
    satellite_ids: set[str],
    strategy: RoutingStrategy = "hops",
    k: int = 3,
) -> list[dict[str, Any]]:
    """
    До k маршрутов с попарно непересекающимися промежуточными КА
    (node-disjoint по спутникам). Первый — основной по выбранной стратегии;
    следующие ищутся после блокировки промежуточных узлов предыдущих путей.
    """
    k = max(1, min(int(k), 5))
    blocked: set[str] = set()
    out: list[dict[str, Any]] = []
    for _ in range(k):
        path = find_route(
            edges,
            client_id,
            gateway_ids,
            satellite_ids,
            strategy=strategy,
            blocked=blocked,
        )
        if not path:
            break
        meta = route_meta(edges, path, strategy)
        meta["index"] = len(out)
        meta["disjoint"] = True
        out.append(meta)
        # Блокируем промежуточные КА, чтобы следующий путь был запасным
        blocked |= {n for n in path[1:-1] if n in satellite_ids}
    return out


def compare_strategies_snapshot(
    edges: list[list],
    client_id: str,
    gateway_ids: set[str],
    satellite_ids: set[str],
) -> dict[str, Any]:
    """Сравнение hops vs distance на одном снимке для одного клиента."""
    result: dict[str, Any] = {}
    for strat in STRATEGIES:
        path = find_route(edges, client_id, gateway_ids, satellite_ids, strategy=strat)
        result[strat] = route_meta(edges, path, strat)
        result[strat]["reachable"] = path is not None
    same = (
        result["hops"]["path"] == result["distance"]["path"]
        if result["hops"]["reachable"] and result["distance"]["reachable"]
        else None
    )
    return {
        "client_id": client_id,
        "strategies": result,
        "paths_identical": same,
        "note": (
            "Достижимость одинакова: обе стратегии находят путь тогда и только тогда, "
            "когда граф связен. Различаются hops и длина пути."
        ),
    }


def classify_outage(
    snap: dict[str, Any],
    client_id: str,
    gateway_ids: set[str],
    satellite_ids: set[str],
    scenario: dict[str, Any],
    t_s: float,
) -> str:
    """
    Причина отсутствия сквозного маршрута в момент t_s.

    Возможные коды (для UI):
      no_visible_satellite — нет КА с elevation >= порога у клиента
      gateway_unavailable  — все шлюзы в outage
      no_gateway_contact   — есть видимость у клиента, но ни один КА не видит активный шлюз
                            и/или нет ребра до gateway (сеть «висит» без выхода)
      isl_partition        — клиент и шлюз «видят» КА, но ISL-граф не связывает стороны
      unknown              — запасной код
    """
    e = scenario["environment"]
    min_el = e["min_elevation_deg"]
    elevations = snap.get("elevation_deg", {}).get(client_id, {})

    # Есть ли видимый активный спутник у клиента?
    visible = [sid for sid, el in elevations.items() if el >= min_el]
    if not visible:
        return "no_visible_satellite"

    # Доступные (не в outage) шлюзы
    offline_gw = {
        f["gateway_id"]
        for f in scenario.get("gateway_outages", [])
        if f["start_s"] <= t_s < f["end_s"]
    }
    live_gateways = gateway_ids - offline_gw
    if not live_gateways:
        return "gateway_unavailable"

    edges = snap["edges"]
    adj = build_adjacency(edges)

    # Контакты клиент–КА
    client_sats = {n for n, _ in adj.get(client_id, []) if n in satellite_ids}
    if not client_sats:
        return "no_visible_satellite"

    # Контакты КА–шлюз
    gw_sats: set[str] = set()
    for gw in live_gateways:
        gw_sats |= {n for n, _ in adj.get(gw, []) if n in satellite_ids}
    if not gw_sats:
        return "no_gateway_contact"

    # Есть ли путь только по спутниковому подграфу от client_sats до gw_sats?
    sat_adj: dict[str, list[str]] = defaultdict(list)
    for a, b, _d in edges:
        if a in satellite_ids and b in satellite_ids:
            sat_adj[a].append(b)
            sat_adj[b].append(a)

    reached: set[str] = set()
    q: deque[str] = deque(client_sats)
    reached.update(client_sats)
    while q:
        node = q.popleft()
        for nxt in sat_adj[node]:
            if nxt not in reached:
                reached.add(nxt)
                q.append(nxt)

    if reached & gw_sats:
        # Геометрически путь должен находиться — сюда попасть не должны,
        # если вызывают после неуспешного find_route
        return "unknown"
    return "isl_partition"


OUTAGE_LABELS_RU = {
    "no_visible_satellite": "Нет видимого спутника у наземного пункта",
    "isl_partition": "Разрыв межспутниковой сети",
    "no_gateway_contact": "Нет контакта со шлюзом",
    "gateway_unavailable": "Шлюз недоступен",
    "unknown": "Маршрут не найден",
}

STRATEGY_LABELS_RU = {
    "hops": "Минимум hops (BFS)",
    "distance": "Минимум длины (Dijkstra)",
}
