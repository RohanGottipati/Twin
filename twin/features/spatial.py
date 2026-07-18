"""Exact per-persona spatial feature extraction (implementation_plan.md
Phase 3):

    "twin/features/: exact computation of per-persona features from the
    *changed* twin: distance to new/removed stops, commute-time delta
    (recompute shortest paths on the network), which tax/fare deltas apply
    to this persona, whether the persona's corridor intersects the
    change."

MVP, exact computation, no GNN (AGENTS.md 4.4: "MVP: compute these features
exactly; skip the GNN... until exact recompute on every agent edit becomes
the interactive-latency bottleneck. Not before.").

Every feature below is computed from a real before/after `TwinState` pair
via `twin/network.py`'s shortest-path routing over the actual street graph
-- no invented numbers, but two named, documented approximations:

  1. **`transit_access_time_*` is a walking-time-to-nearest-stop proxy, not
     a full origin-destination commute time.** A real commute time needs a
     workplace destination per persona (not in the census data we have)
     and the GTFS `stop_times.txt` schedule join Phase 0 deliberately
     skipped (see `data/ingest.py`). This feature answers "did this change
     make transit locally more/less reachable from home," which is a
     real, useful, exactly-computed planning metric (a standard
     "transit accessibility" measure), just not the same thing as
     "minutes to work."
  2. **Walking speed is a fixed assumption** (`WALKING_SPEED_M_PER_MIN`),
     used only to convert an exact network distance into a time figure for
     the prompt; the distance itself is exact.

`on_corridor` and `distance_to_change_m` are exact network-shortest-path
distances to the nearest point of the actual geometric diff between the
two states (via `twin/diff.py`), not a straight-line approximation like
`eval/heatmap_phase1.py`'s Phase 1 MVP used.
"""

from __future__ import annotations

from dataclasses import dataclass

from shapely.geometry import shape

from population.sampler import Persona
from twin.diff import diff
from twin.network import shortest_path_length_m, street_graph
from twin.state import TwinState

# Standard pedestrian planning assumption (~4.8 km/h). Only used to turn an
# exact network distance into a "minutes" figure for the prompt.
WALKING_SPEED_M_PER_MIN = 80.0

# A persona within this network distance of the change is considered "on
# the corridor" -- roughly a 5-10 minute walk, a standard transit-walkshed
# threshold in planning practice.
CORRIDOR_THRESHOLD_M = 500.0


@dataclass(frozen=True)
class PolicyApplication:
    policy_id: str
    kind: str
    value: float
    applies: bool
    reason: str


@dataclass(frozen=True)
class SpatialFeatures:
    persona_id: str
    distance_to_change_m: float | None
    on_corridor: bool
    transit_access_time_before_min: float | None
    transit_access_time_after_min: float | None
    transit_access_time_delta_min: float | None
    applicable_policies: tuple[PolicyApplication, ...]


def _geom_vertices(geom) -> list[tuple[float, float]]:
    """Every coordinate vertex of a geometry, for any of the types the twin
    uses (see twin/schema.py's GeometryType). Multi-part geometries don't
    expose `.coords` at all in shapely (it raises `NotImplementedError`,
    not `AttributeError` -- `hasattr()` doesn't catch that), so this
    dispatches on `geom_type` explicitly rather than duck-typing."""
    if geom.geom_type == "Polygon":
        return list(geom.exterior.coords)
    if geom.geom_type == "MultiPolygon":
        points: list[tuple[float, float]] = []
        for part in geom.geoms:
            points.extend(part.exterior.coords)
        return points
    if geom.geom_type in ("MultiLineString", "MultiPoint"):
        points = []
        for part in geom.geoms:
            points.extend(part.coords)
        return points
    # Point, LineString
    return list(geom.coords)


def _diff_change_points(before: TwinState, after: TwinState) -> list[tuple[float, float]]:
    """Every distinct coordinate vertex touched by the diff between the two
    states (added/removed/modified features across all layers) -- the
    "footprint" of the change, for distance-to-change computation."""
    d = diff(before, after)
    points: list[tuple[float, float]] = []
    for layer, layer_diff in d.layers.items():
        for feature_id in list(layer_diff.added) + list(layer_diff.removed) + list(layer_diff.modified):
            # Prefer the "after" version when present (added/modified),
            # fall back to "before" (removed).
            feat = after.get(layer, feature_id) or before.get(layer, feature_id)  # type: ignore[arg-type]
            if feat is None:
                continue
            geom = shape(feat.geometry.model_dump())
            points.extend(_geom_vertices(geom))
    return points


def _distance_to_change(home: tuple[float, float], change_points: list[tuple[float, float]], graph) -> float | None:
    if not change_points:
        return None
    distances = [shortest_path_length_m(graph, home, pt) for pt in change_points]
    valid = [d for d in distances if d is not None]
    return min(valid) if valid else None


def _nearest_transit_access_time_min(home: tuple[float, float], state: TwinState, graph) -> float | None:
    stops = state.all_features("transit_stops")
    if not stops:
        return None
    distances = []
    for stop in stops:
        stop_point = shape(stop.geometry.model_dump())
        d = shortest_path_length_m(graph, home, (stop_point.x, stop_point.y))
        if d is not None:
            distances.append(d)
    if not distances:
        return None
    return min(distances) / WALKING_SPEED_M_PER_MIN


def _policy_applicability(home: tuple[float, float], state: TwinState) -> tuple[PolicyApplication, ...]:
    from shapely.geometry import Point

    home_point = Point(home)
    home_zone_id: str | None = None
    for parcel in state.all_features("zoning"):
        geom = shape(parcel.geometry.model_dump())
        if geom.contains(home_point) or geom.intersects(home_point):
            home_zone_id = parcel.id
            break

    applications = []
    for policy in state.policies.values():
        if policy.zone_id is None:
            applications.append(
                PolicyApplication(policy.id, policy.kind, policy.value, True, "citywide policy, applies to everyone")
            )
        elif policy.zone_id == home_zone_id:
            applications.append(
                PolicyApplication(policy.id, policy.kind, policy.value, True, f"home is in zone {policy.zone_id}")
            )
        else:
            applications.append(
                PolicyApplication(
                    policy.id, policy.kind, policy.value, False, f"home zone {home_zone_id!r} != policy zone {policy.zone_id!r}"
                )
            )
    return tuple(applications)


def compute_spatial_features(persona: Persona, before: TwinState, after: TwinState) -> SpatialFeatures:
    """The exact, per-persona feature set for one policy change, comparing
    `before` (pre-edit) and `after` (post-`patch()`) states."""
    home = (persona.home_x, persona.home_y)
    graph_before = street_graph(before, weighted=True)
    graph_after = street_graph(after, weighted=True)

    change_points = _diff_change_points(before, after)
    distance_to_change = _distance_to_change(home, change_points, graph_after)
    on_corridor = distance_to_change is not None and distance_to_change <= CORRIDOR_THRESHOLD_M

    access_before = _nearest_transit_access_time_min(home, before, graph_before)
    access_after = _nearest_transit_access_time_min(home, after, graph_after)
    delta = (access_after - access_before) if (access_before is not None and access_after is not None) else None

    policies = _policy_applicability(home, after)

    return SpatialFeatures(
        persona_id=persona.id,
        distance_to_change_m=distance_to_change,
        on_corridor=on_corridor,
        transit_access_time_before_min=access_before,
        transit_access_time_after_min=access_after,
        transit_access_time_delta_min=delta,
        applicable_policies=policies,
    )


def build_spatial_block(features: SpatialFeatures) -> str:
    """Render as the structured `SPATIAL:` prompt block
    (implementation_plan.md Phase 3: "Inject these as a structured
    SPATIAL: block into the prompt")."""
    lines = ["SPATIAL:"]
    if features.distance_to_change_m is not None:
        lines.append(f"- Distance from home to the change (by street network): {features.distance_to_change_m:.0f}m")
        lines.append(f"- On the directly affected corridor: {'yes' if features.on_corridor else 'no'}")
    else:
        lines.append("- Distance from home to the change: unknown (no route found)")

    if features.transit_access_time_delta_min is not None:
        direction = "improves" if features.transit_access_time_delta_min < 0 else "worsens" if features.transit_access_time_delta_min > 0 else "does not change"
        lines.append(
            f"- Walk time to nearest transit stop: {features.transit_access_time_before_min:.1f} min before, "
            f"{features.transit_access_time_after_min:.1f} min after ({direction})"
        )

    if features.applicable_policies:
        lines.append("- Policy changes that apply to you:")
        for policy in features.applicable_policies:
            if policy.applies:
                lines.append(f"  - {policy.kind} = {policy.value} ({policy.reason})")
        if not any(p.applies for p in features.applicable_policies):
            lines.append("  - none")

    return "\n".join(lines)
