"""The Phase 0 gate, automated (implementation_plan.md Phase 0):

    "A manual `patch` that adds a transit stop off the network is rejected
    by invariants; a valid one applies, versions, and produces a correct
    diff."

This is the actual re-verifiable gate check, not a one-off manual run.
"""

from __future__ import annotations

import pytest
from shapely.geometry import shape

from twin.diff import diff
from twin.schema import Edit
from twin.state import TwinInvariantError, TwinState, patch


def _first_street_coord(state: TwinState) -> tuple[float, float]:
    street = state.all_features("streets")[0]
    geom = shape(street.geometry.model_dump())
    line = geom.geoms[0] if geom.geom_type == "MultiLineString" else geom
    return line.coords[0]


def test_off_network_stop_is_rejected(base_state: TwinState):
    x, y = _first_street_coord(base_state)
    # 5km away from a real street coordinate: nowhere near any street or
    # transit shape in this (or any) network.
    off_network_point = {"type": "Point", "coordinates": [x + 5000.0, y + 5000.0]}
    edit = Edit(
        op="add",
        layer="transit_stops",
        feature_id="transit_stops:test-off-network",
        feature={
            "geometry": off_network_point,
            "stop_name": "Off-Network Test Stop",
            "mode": "bus",
        },
    )

    with pytest.raises(TwinInvariantError) as excinfo:
        patch(base_state, [edit])

    assert any("test-off-network" in v for v in excinfo.value.violations)
    # Rejection must not mutate the caller's state.
    assert base_state.get("transit_stops", "transit_stops:test-off-network") is None
    assert base_state.version == 0


def test_valid_stop_applies_versions_and_diffs(base_state: TwinState):
    x, y = _first_street_coord(base_state)
    # 5m from a real street coordinate: well within the network tolerance.
    on_network_point = {"type": "Point", "coordinates": [x + 5.0, y + 5.0]}
    feature_id = "transit_stops:test-new-stop"
    edit = Edit(
        op="add",
        layer="transit_stops",
        feature_id=feature_id,
        feature={
            "geometry": on_network_point,
            "stop_name": "New Test Stop",
            "mode": "streetcar",
        },
    )

    new_state = patch(base_state, [edit])

    # Applies.
    added_stop = new_state.get("transit_stops", feature_id)
    assert added_stop is not None
    assert added_stop.stop_name == "New Test Stop"

    # Versions.
    assert new_state.version == base_state.version + 1
    assert new_state.parent_version == base_state.version
    # Original state untouched (immutability).
    assert base_state.get("transit_stops", feature_id) is None

    # Produces a correct diff.
    d = diff(base_state, new_state)
    assert d.from_version == base_state.version
    assert d.to_version == new_state.version
    assert feature_id in d.layers["transit_stops"].added
    assert d.layers["transit_stops"].removed == []
    assert not d.layers["streets"].added and not d.layers["streets"].removed and not d.layers["streets"].modified
    assert not d.is_empty
