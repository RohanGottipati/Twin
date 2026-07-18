"""Invariant checks for the city twin compiler (AGENTS.md 4.1).

`check_all(state, parent=None)` is the single entry point
`twin/state.py:patch()` calls before committing any edit. It returns a list
of human-readable violation strings; an empty list means the state is
valid. Most checks operate on the *resulting* candidate TwinState only;
`patch()` also passes the pre-edit `parent` state so checks that need a
before/after comparison (e.g. "did this edit disconnect the network?") can
do one without threading extra plumbing through every call site.

Phase 0/1 passes. Implemented:
  - transit stops must sit on (or very near) the street/transit network --
    this is the Phase 0 gate invariant.
  - policy values may only reference zoning parcels that exist.
  - every feature's geometry must be structurally valid and of the type its
    layer expects.
  - a street segment introduced or modified by an edit must actually connect
    to the rest of the street network (no edit may splice in a segment with
    both endpoints floating in space).
  - a street segment *removed* by an edit must not disconnect two parts of
    the network that were only connected through it (a before/after
    connected-component comparison, using `parent`). This was logged as a
    documented gap after Phase 0 and is closed here.

Deliberately NOT implemented yet:
  - derived-quantity recompute (commute times, accessibility) -- that's
    `twin/features/`, explicitly Phase 3 scope.
"""

from __future__ import annotations

import networkx as nx
from shapely.geometry import shape
from shapely.geometry.base import BaseGeometry

from twin.network import snap, street_graph
from twin.schema import LayerName
from twin.state import TwinState

# How close a transit stop must be to the street/transit-shape network to
# count as "on the network". 35m covers GPS/geocoding slop and the offset
# between an underground subway station's point and the street centreline
# above it, while still rejecting a stop placed on an unrelated block.
TRANSIT_STOP_NETWORK_TOLERANCE_M = 35.0

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
                node_owners.setdefault(snap(endpoint), set()).add(feat.id)

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
                owners = node_owners.get(snap(endpoint), set())
                if owners - {feature_id}:
                    touches_other = True
        if not touches_other and len(all_streets) > 1:
            violations.append(
                f"streets:{feature_id} does not share an endpoint with any other street segment "
                "(edit would splice in a disconnected fragment)"
            )
    return violations


def check_street_removal_preserves_connectivity(state: TwinState, parent: TwinState | None) -> list[str]:
    """A street segment *removed* by this edit set must not disconnect two
    parts of the network that were only connected through it. Needs the
    pre-edit `parent` state to know what the network looked like before the
    removal; a no-op (returns no violations) when no parent is given, e.g.
    when a TwinState is validated standalone rather than via patch()."""
    if parent is None:
        return []
    removed_street_ids = {
        edit.feature_id for edit in state.edits_applied if edit.layer == "streets" and edit.op == "remove"
    }
    if not removed_street_ids:
        return []

    parent_graph = street_graph(parent)
    candidate_graph = street_graph(state)

    violations: list[str] = []
    for feature_id in removed_street_ids:
        # Find the removed segment's endpoints from the parent graph (the
        # only place it still exists).
        endpoints = [
            (u, v) for u, v, data in parent_graph.edges(data=True) if data.get("feature_id") == feature_id
        ]
        for u, v in endpoints:
            # If either endpoint no longer exists in the candidate network at
            # all, there's nothing else that used to route through it --
            # removing a dead-end is fine.
            if u not in candidate_graph or v not in candidate_graph:
                continue
            if not nx.has_path(candidate_graph, u, v):
                violations.append(
                    f"streets:{feature_id} removal disconnects the network: no remaining path between "
                    f"its former endpoints {u} and {v}"
                )
    return violations


CHECKS_STATE_ONLY = (
    check_geometry_validity,
    check_transit_stops_on_network,
    check_policy_zone_references,
    check_street_network_edits_connect,
)

CHECKS_WITH_PARENT = (check_street_removal_preserves_connectivity,)


def check_all(state: TwinState, parent: TwinState | None = None) -> list[str]:
    violations: list[str] = []
    for check in CHECKS_STATE_ONLY:
        violations.extend(check(state))
    for check_with_parent in CHECKS_WITH_PARENT:
        violations.extend(check_with_parent(state, parent))
    return violations
