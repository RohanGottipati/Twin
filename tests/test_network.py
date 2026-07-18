"""Unit tests for twin/network.py's shared graph utilities, against small
synthetic states."""

from __future__ import annotations

from twin.network import nearest_node, shortest_path_length_m, snap, street_graph
from twin.schema import StreetSegment
from twin.state import TwinState


def _street(id_: str, coords: list[tuple[float, float]]) -> StreetSegment:
    return StreetSegment(id=id_, geometry={"type": "LineString", "coordinates": coords})


def _state(streets: dict) -> TwinState:
    return TwinState(
        layers={"streets": streets, "buildings": {}, "zoning": {}, "parks": {}, "transit_stops": {}, "transit_shapes": {}},
        policies={},
        version=0,
        parent_version=None,
    )


def test_snap_rounds_to_tolerance():
    assert snap((10.4, 20.4), tol=1.0) == (10.0, 20.0)
    assert snap((10.6, 20.6), tol=1.0) == (11.0, 21.0)


def test_street_graph_weighted_carries_length():
    state = _state({"streets:1": _street("streets:1", [(0, 0), (100, 0)])})
    graph = street_graph(state, weighted=True)
    edge_data = list(graph.edges(data=True))[0][2]
    assert edge_data["length"] == 100.0


def test_street_graph_unweighted_has_no_length():
    state = _state({"streets:1": _street("streets:1", [(0, 0), (100, 0)])})
    graph = street_graph(state, weighted=False)
    edge_data = list(graph.edges(data=True))[0][2]
    assert "length" not in edge_data


def test_nearest_node_finds_closest():
    state = _state(
        {
            "streets:1": _street("streets:1", [(0, 0), (100, 0)]),
            "streets:2": _street("streets:2", [(100, 0), (100, 100)]),
        }
    )
    graph = street_graph(state)
    assert nearest_node(graph, (5, 5)) == (0, 0)
    assert nearest_node(graph, (95, 95)) == (100, 100)


def test_nearest_node_empty_graph_returns_none():
    import networkx as nx

    assert nearest_node(nx.Graph(), (0, 0)) is None


def test_shortest_path_length_straight_line():
    state = _state({"streets:1": _street("streets:1", [(0, 0), (100, 0)])})
    graph = street_graph(state, weighted=True)
    dist = shortest_path_length_m(graph, (0, 0), (100, 0))
    assert dist == 100.0


def test_shortest_path_length_via_two_segments():
    state = _state(
        {
            "streets:1": _street("streets:1", [(0, 0), (100, 0)]),
            "streets:2": _street("streets:2", [(100, 0), (100, 100)]),
        }
    )
    graph = street_graph(state, weighted=True)
    dist = shortest_path_length_m(graph, (0, 0), (100, 100))
    assert dist == 200.0


def test_shortest_path_length_none_when_disconnected():
    state = _state(
        {
            "streets:1": _street("streets:1", [(0, 0), (100, 0)]),
            "streets:2": _street("streets:2", [(5000, 5000), (5100, 5000)]),
        }
    )
    graph = street_graph(state, weighted=True)
    assert shortest_path_length_m(graph, (0, 0), (5000, 5000)) is None
