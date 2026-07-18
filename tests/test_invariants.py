"""Unit tests for each invariant in twin/invariants.py, against small
synthetic states (no dependency on the real ingested data, so these are fast
and isolate the logic being tested)."""

from __future__ import annotations

from twin.invariants import (
    check_geometry_validity,
    check_policy_zone_references,
    check_street_network_edits_connect,
    check_transit_stops_on_network,
)
from twin.schema import Edit, PolicyValue, StreetSegment, TransitStop, ZoningParcel
from twin.state import TwinState


def _street(id_: str, coords: list[tuple[float, float]]) -> StreetSegment:
    return StreetSegment(id=id_, geometry={"type": "LineString", "coordinates": coords})


def _empty_state(**overrides) -> TwinState:
    layers = {
        "streets": {},
        "buildings": {},
        "zoning": {},
        "parks": {},
        "transit_stops": {},
        "transit_shapes": {},
    }
    layers.update(overrides.pop("layers", {}))
    return TwinState(layers=layers, policies=overrides.pop("policies", {}), version=0, parent_version=None)


# ---- transit stop / network proximity --------------------------------------


def test_stop_near_street_passes():
    state = _empty_state(
        layers={
            "streets": {"streets:1": _street("streets:1", [(0, 0), (100, 0)])},
            "transit_stops": {
                "transit_stops:1": TransitStop(id="transit_stops:1", geometry={"type": "Point", "coordinates": [10, 5]})
            },
        }
    )
    assert check_transit_stops_on_network(state) == []


def test_stop_far_from_street_fails():
    state = _empty_state(
        layers={
            "streets": {"streets:1": _street("streets:1", [(0, 0), (100, 0)])},
            "transit_stops": {
                "transit_stops:1": TransitStop(
                    id="transit_stops:1", geometry={"type": "Point", "coordinates": [10, 5000]}
                )
            },
        }
    )
    violations = check_transit_stops_on_network(state)
    assert len(violations) == 1
    assert "transit_stops:1" in violations[0]


def test_no_network_at_all_does_not_crash():
    state = _empty_state(
        layers={
            "transit_stops": {
                "transit_stops:1": TransitStop(id="transit_stops:1", geometry={"type": "Point", "coordinates": [0, 0]})
            }
        }
    )
    assert check_transit_stops_on_network(state) == []


# ---- policy / zoning references --------------------------------------------


def test_policy_referencing_existing_zone_passes():
    state = _empty_state(
        layers={"zoning": {"zoning:1": ZoningParcel(id="zoning:1", geometry={"type": "Polygon", "coordinates": [[(0, 0), (1, 0), (1, 1), (0, 0)]]})}},
        policies={"policy:1": PolicyValue(id="policy:1", kind="parking_tax_pct", zone_id="zoning:1", value=5.0)},
    )
    assert check_policy_zone_references(state) == []


def test_policy_referencing_missing_zone_fails():
    state = _empty_state(
        policies={"policy:1": PolicyValue(id="policy:1", kind="parking_tax_pct", zone_id="zoning:nonexistent", value=5.0)}
    )
    violations = check_policy_zone_references(state)
    assert len(violations) == 1
    assert "zoning:nonexistent" in violations[0]


def test_citywide_policy_with_no_zone_id_passes():
    state = _empty_state(policies={"policy:1": PolicyValue(id="policy:1", kind="transit_fare", zone_id=None, value=3.35)})
    assert check_policy_zone_references(state) == []


# ---- geometry validity ------------------------------------------------------


def test_valid_geometries_pass():
    state = _empty_state(layers={"streets": {"streets:1": _street("streets:1", [(0, 0), (10, 0)])}})
    assert check_geometry_validity(state) == []


def test_self_intersecting_polygon_fails():
    bowtie = ZoningParcel(
        id="zoning:bowtie",
        geometry={"type": "Polygon", "coordinates": [[(0, 0), (1, 1), (1, 0), (0, 1), (0, 0)]]},
    )
    state = _empty_state(layers={"zoning": {"zoning:bowtie": bowtie}})
    violations = check_geometry_validity(state)
    assert len(violations) == 1
    assert "zoning:bowtie" in violations[0]


def test_wrong_geometry_type_for_layer_fails():
    # A transit stop is supposed to be a Point, not a LineString.
    bad_stop = TransitStop(id="transit_stops:bad", geometry={"type": "LineString", "coordinates": [(0, 0), (1, 1)]})
    state = _empty_state(layers={"transit_stops": {"transit_stops:bad": bad_stop}})
    violations = check_geometry_validity(state)
    assert len(violations) == 1
    assert "transit_stops:bad" in violations[0]


# ---- street network connectivity on edit -----------------------------------


def test_added_street_connected_to_network_passes():
    state = _empty_state(
        layers={
            "streets": {
                "streets:1": _street("streets:1", [(0, 0), (100, 0)]),
                "streets:2": _street("streets:2", [(100, 0), (200, 0)]),  # shares endpoint with streets:1
            }
        },
        policies={},
    )
    state = TwinState(
        layers=state.layers,
        policies=state.policies,
        version=1,
        parent_version=0,
        edits_applied=(Edit(op="add", layer="streets", feature_id="streets:2", feature={}),),
    )
    assert check_street_network_edits_connect(state) == []


def test_added_street_disconnected_from_network_fails():
    state = _empty_state(
        layers={
            "streets": {
                "streets:1": _street("streets:1", [(0, 0), (100, 0)]),
                "streets:2": _street("streets:2", [(5000, 5000), (5100, 5000)]),  # floating fragment
            }
        }
    )
    state = TwinState(
        layers=state.layers,
        policies=state.policies,
        version=1,
        parent_version=0,
        edits_applied=(Edit(op="add", layer="streets", feature_id="streets:2", feature={}),),
    )
    violations = check_street_network_edits_connect(state)
    assert len(violations) == 1
    assert "streets:2" in violations[0]


def test_unedited_streets_are_not_checked():
    # streets:2 is a pre-existing disconnected fragment (real data has a few
    # of these at clip boundaries); since it wasn't touched by this edit
    # set, it should not block the patch.
    state = _empty_state(
        layers={
            "streets": {
                "streets:1": _street("streets:1", [(0, 0), (100, 0)]),
                "streets:2": _street("streets:2", [(5000, 5000), (5100, 5000)]),
            },
            "parks": {},
        }
    )
    state = TwinState(
        layers=state.layers,
        policies=state.policies,
        version=1,
        parent_version=0,
        edits_applied=(Edit(op="add", layer="parks", feature_id="parks:1", feature={}),),
    )
    assert check_street_network_edits_connect(state) == []
