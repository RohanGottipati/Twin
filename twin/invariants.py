"""Invariant checks for the city twin compiler (AGENTS.md 4.1).

`check_all(state)` is the single entry point `twin/state.py:patch()` calls
before committing any edit. It returns a list of human-readable violation
strings; an empty list means the state is valid. Every check here operates
on the *resulting* candidate TwinState only (no access to the pre-edit
parent state is assumed), which keeps `patch()` simple: validate the
candidate, commit or reject, never partially apply.

Phase 0 first pass. Implemented:
  - transit stops must sit on (or very near) the street/transit network --
    this is the Phase 0 gate invariant.
  - policy values may only reference zoning parcels that exist.
  - every feature's geometry must be structurally valid and of the type its
    layer expects.
  - a street segment introduced or modified by an edit must actually connect
    to the rest of the street network (no edit may splice in a segment with
    both endpoints floating in space).

Deliberately NOT implemented yet (documented, not silently skipped):
  - full before/after connected-component comparison to catch a `remove`
    that severs previously-joined parts of the network. That needs the
    parent TwinState threaded into the check, which `patch()` doesn't do
    yet. Tracked as Phase 1 follow-up in OVERNIGHT_LOG.md; it is an
    engineering gap, not one of the AGENTS.md section 9 open questions, so
    it's safe to pick up without human sign-off.
  - derived-quantity recompute (commute times, accessibility) -- that's
    `twin/features/`, explicitly Phase 3 scope.
"""

from __future__ import annotations

from shapely.geometry import shape
from shapely.geometry.base import BaseGeometry

from twin.schema import LayerName
from twin.state import TwinState

# How close a transit stop must be to the street/transit-shape network to
# count as "on the network". 35m covers GPS/geocoding slop and the offset
# between an underground subway station's point and the street centreline
# above it, while still rejecting a stop placed on an unrelated block.
TRANSIT_STOP_NETWORK_TOLERANCE_M = 35.0

# Snap tolerance for treating two street-segment endpoints as "the same
# node". Matches the tolerance used in data exploration for this network.
STREET_NODE_SNAP_TOLERANCE_M = 1.0

_EXPECTED_GEOM_TYPES: dict[LayerName, set[str]] = {
    "streets": {"LineString", "MultiLineString"},
    "buildings": {"Polygon", "MultiPolygon"},
    "zoning": {"Polygon", "MultiPolygon"},
    "parks": {"Point", "Polygon", "MultiPolygon"},
    "transit_stops": {"Point"},
    "transit_shapes": {"LineString", "MultiLineString"},
}


def _network_geoms(state: TwinState) -> list[BaseGeometry]:
    geoms: list[BaseGeometry] = []
    for layer in ("streets", "transit_shapes"):
        for feat in state.all_features(layer):  # type: ignore[arg-type]
            geoms.append(shape(feat.geometry.model_dump()))
    return geoms


def check_transit_stops_on_network(state: TwinState) -> list[str]:
    violations: list[str] = []
    network = _network_geoms(state)
    if not network:
        # No network to check against at all is itself a data problem, but
        # not one this check is responsible for reporting.
        return violations
    for stop in state.all_features("transit_stops"):
        point = shape(stop.geometry.model_dump())
        min_dist = min(point.distance(g) for g in network)
        if min_dist > TRANSIT_STOP_NETWORK_TOLERANCE_M:
            violations.append(
                f"transit_stops:{stop.id} is {min_dist:.1f}m from the nearest street/transit "
                f"geometry, exceeding the {TRANSIT_STOP_NETWORK_TOLERANCE_M}m network tolerance"
            )
    return violations


def check_policy_zone_references(state: TwinState) -> list[str]:
    violations: list[str] = []
    zoning_ids = set(state.layers.get("zoning", {}).keys())
    for policy in state.policies.values():
        if policy.zone_id is not None and policy.zone_id not in zoning_ids:
            violations.append(
                f"policy:{policy.id} ({policy.kind}) references zone_id={policy.zone_id!r}, "
                "which does not exist in the zoning layer"
            )
    return violations


def check_geometry_validity(state: TwinState) -> list[str]:
    violations: list[str] = []
    for layer, features in state.layers.items():
        expected_types = _EXPECTED_GEOM_TYPES.get(layer, set())
        for feat in features.values():
            geom_dict = feat.geometry.model_dump()
            if expected_types and geom_dict["type"] not in expected_types:
                violations.append(
                    f"{layer}:{feat.id} has geometry type {geom_dict['type']!r}, "
                    f"expected one of {sorted(expected_types)}"
                )
                continue
            geom = shape(geom_dict)
            if not geom.is_valid:
                violations.append(f"{layer}:{feat.id} has an invalid (self-intersecting or malformed) geometry")
    return violations


def _snap(coord: tuple[float, float], tol: float = STREET_NODE_SNAP_TOLERANCE_M) -> tuple[float, float]:
    return (round(coord[0] / tol) * tol, round(coord[1] / tol) * tol)


def check_street_network_edits_connect(state: TwinState) -> list[str]:
    """A street segment that was added or modified by the edit set producing
    this state must share an endpoint (within snap tolerance) with some
    *other* street segment in the resulting network. Guards against an edit
    splicing a disconnected fragment into the network."""
    edited_street_ids = {
        edit.feature_id for edit in state.edits_applied if edit.layer == "streets" and edit.op in ("add", "modify")
    }
    if not edited_street_ids:
        return []

    all_streets = state.all_features("streets")
    node_owners: dict[tuple[float, float], set[str]] = {}
    for feat in all_streets:
        geom = shape(feat.geometry.model_dump())
        lines = list(geom.geoms) if geom.geom_type == "MultiLineString" else [geom]
        for line in lines:
            coords = list(line.coords)
            for endpoint in (coords[0], coords[-1]):
                node_owners.setdefault(_snap(endpoint), set()).add(feat.id)

    violations: list[str] = []
    for feature_id in edited_street_ids:
        feat = state.get("streets", feature_id)
        if feat is None:
            continue  # removed by a later edit in the same batch
        geom = shape(feat.geometry.model_dump())
        lines = list(geom.geoms) if geom.geom_type == "MultiLineString" else [geom]
        touches_other = False
        for line in lines:
            coords = list(line.coords)
            for endpoint in (coords[0], coords[-1]):
                owners = node_owners.get(_snap(endpoint), set())
                if owners - {feature_id}:
                    touches_other = True
        if not touches_other and len(all_streets) > 1:
            violations.append(
                f"streets:{feature_id} does not share an endpoint with any other street segment "
                "(edit would splice in a disconnected fragment)"
            )
    return violations


CHECKS = (
    check_geometry_validity,
    check_transit_stops_on_network,
    check_policy_zone_references,
    check_street_network_edits_connect,
)


def check_all(state: TwinState) -> list[str]:
    violations: list[str] = []
    for check in CHECKS:
        violations.extend(check(state))
    return violations
