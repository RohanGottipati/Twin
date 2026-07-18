"""Unit tests for twin/diff.py against synthetic states."""

from __future__ import annotations

from twin.diff import diff
from twin.schema import ZoningParcel
from twin.state import TwinState


def _zone(id_: str, category: str) -> ZoningParcel:
    return ZoningParcel(
        id=id_,
        geometry={"type": "Polygon", "coordinates": [[(0, 0), (1, 0), (1, 1), (0, 0)]]},
        zone_category=category,
    )


def _state(zoning: dict, version: int, parent: int | None) -> TwinState:
    return TwinState(
        layers={"streets": {}, "buildings": {}, "zoning": zoning, "parks": {}, "transit_stops": {}, "transit_shapes": {}},
        policies={},
        version=version,
        parent_version=parent,
    )


def test_diff_detects_added_removed_modified():
    a = _state({"zoning:1": _zone("zoning:1", "R"), "zoning:2": _zone("zoning:2", "C")}, version=0, parent=None)
    b = _state({"zoning:1": _zone("zoning:1", "MU"), "zoning:3": _zone("zoning:3", "I")}, version=1, parent=0)

    d = diff(a, b)

    assert d.from_version == 0
    assert d.to_version == 1
    zoning_diff = d.layers["zoning"]
    assert zoning_diff.added == ["zoning:3"]
    assert zoning_diff.removed == ["zoning:2"]
    assert "zoning:1" in zoning_diff.modified
    assert zoning_diff.modified["zoning:1"]["zone_category"] == ("R", "MU")


def test_diff_of_identical_states_is_empty():
    zoning = {"zoning:1": _zone("zoning:1", "R")}
    a = _state(dict(zoning), version=0, parent=None)
    b = _state(dict(zoning), version=0, parent=None)
    d = diff(a, b)
    assert d.is_empty
