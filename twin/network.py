"""Shared street-network graph utilities.

Extracted out of `twin/invariants.py` (which needs an unweighted graph for
connectivity checks) so `twin/features/` (which needs a *weighted* graph for
shortest-path distance) doesn't reimplement the same node-snapping and
edge-building logic. One owner module for "what does the street network
look like as a graph," per the DRY working principle -- three real call
sites (two invariant checks + feature computation) justify the extraction.
"""

from __future__ import annotations

import networkx as nx
from shapely.geometry import Point, shape

from twin.state import TwinState

# Snap tolerance for treating two street-segment endpoints as "the same
# node". Matches the tolerance used in data exploration for this network.
STREET_NODE_SNAP_TOLERANCE_M = 1.0

Coord = tuple[float, float]


def snap(coord: Coord, tol: float = STREET_NODE_SNAP_TOLERANCE_M) -> Coord:
    return (round(coord[0] / tol) * tol, round(coord[1] / tol) * tol)


def street_graph(state: TwinState, *, weighted: bool = False) -> nx.Graph:
    """Build a graph from the twin's street layer: nodes are snapped
    segment endpoints, edges are street segments. When `weighted=True`,
    each edge also carries a `length` attribute (metres, from the actual
    geometry) for shortest-*distance* routing; `invariants.py`'s
    connectivity checks don't need weights, only topology, so they use the
    cheaper unweighted default.
    """
    graph = nx.Graph()
    for feat in state.all_features("streets"):
        geom = shape(feat.geometry.model_dump())
        lines = list(geom.geoms) if geom.geom_type == "MultiLineString" else [geom]
        for line in lines:
            coords = list(line.coords)
            u, v = snap(coords[0]), snap(coords[-1])
            edge_kwargs = {"feature_id": feat.id}
            if weighted:
                edge_kwargs["length"] = line.length
            graph.add_edge(u, v, **edge_kwargs)
    return graph


def nearest_node(graph: nx.Graph, point: Coord) -> Coord | None:
    """The graph node closest (straight-line) to an arbitrary point, for
    snapping a persona's home, a transit stop, or a policy-change location
    onto the routable network. Returns None if the graph has no nodes."""
    if graph.number_of_nodes() == 0:
        return None
    target = Point(point)
    return min(graph.nodes, key=lambda n: target.distance(Point(n)))


def shortest_path_length_m(graph: nx.Graph, source: Coord, target: Coord) -> float | None:
    """Shortest-path distance in metres between two arbitrary points,
    snapped onto the nearest graph node each. Returns None if either point
    can't be snapped (empty graph) or no path exists between the two
    snapped nodes (disconnected components -- a real possibility given the
    network has a few disconnected fragments at the study-area clip
    boundary, see data/ingest.py)."""
    u = nearest_node(graph, source)
    v = nearest_node(graph, target)
    if u is None or v is None:
        return None
    try:
        return nx.shortest_path_length(graph, u, v, weight="length")
    except nx.NetworkXNoPath:
        return None
