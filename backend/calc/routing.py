"""
Маршрутизация client → спутники → gateway по снимку сети.

Алгоритм: BFS по числу рёбер (минимум hops). Дистанции на рёбрах —
только для отображения, на выбор пути не влияют.

NOTE: чтобы сменить стратегию (Dijkstra по длине, k-shortest и т.п.),
замените find_route(); classify_outage можно оставить.
"""

from __future__ import annotations

from collections import defaultdict, deque
from typing import Any


def build_adjacency(edges: list[list]) -> dict[str, list[tuple[str, float]]]:
    """Неориентированный граф из списка [id_a, id_b, distance_km]."""
    adj: dict[str, list[tuple[str, float]]] = defaultdict(list)
    for a, b, dist in edges:
        adj[a].append((b, float(dist)))
        adj[b].append((a, float(dist)))
    return adj


def find_route(
    edges: list[list],
    client_id: str,
    gateway_ids: set[str],
    satellite_ids: set[str],
) -> list[str] | None:
    """
    Кратчайший (по hops) путь client → … → gateway.

    Ограничения модели:
    - промежуточные узлы — только спутники (наземные пункты не ретранслируют);
    - путь обязан начинаться в client_id и заканчиваться в одном из gateway_ids;
    - рёбра client–gateway напрямую допустимы, если есть в edges (редко).

    Возвращает список id узлов [client, ..., gateway] или None.
    """
    if not gateway_ids:
        return None
    adj = build_adjacency(edges)
    if client_id not in adj:
        return None

    # BFS: состояние = текущий узел; parent для восстановления пути
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
            # С client можно идти на КА или сразу на gateway.
            # С КА — на другой КА или на gateway. С gateway дальше не идём.
            if node == client_id:
                if nxt not in satellite_ids and nxt not in gateway_ids:
                    continue
            elif node in satellite_ids:
                if nxt not in satellite_ids and nxt not in gateway_ids:
                    continue
            else:
                # оказались на gateway в середине — не расширяем
                continue
            parent[nxt] = node
            queue.append(nxt)

    if found is None:
        return None

    path: list[str] = []
    cur: str | None = found
    while cur is not None:
        path.append(cur)
        cur = parent[cur]
    path.reverse()
    return path


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
