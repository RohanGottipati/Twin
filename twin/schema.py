"""Typed schema for the TechTO city twin (AGENTS.md section 7: the compiler).

All geometry is stored in NAD83 / UTM zone 17N (EPSG:26917), per the Phase 0
gate in implementation_plan.md. Geometry is kept as a small GeoJSON-shaped
Pydantic model (type + coordinates) rather than a shapely object directly, so
the schema stays JSON-serializable end to end (versioned snapshots, diffs);
`twin/state.py` is the boundary that converts to/from shapely for computation
(e.g. distance checks in invariants.py).
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

CRS = "EPSG:26917"  # NAD83 / UTM zone 17N

GeometryType = Literal[
    "Point",
    "MultiPoint",
    "LineString",
    "MultiLineString",
    "Polygon",
    "MultiPolygon",
]

LayerName = Literal[
    "streets",
    "buildings",
    "zoning",
    "parks",
    "transit_stops",
    "transit_shapes",
]

TransitMode = Literal["bus", "streetcar", "subway", "other"]


class Geometry(BaseModel):
    """A GeoJSON-shaped geometry, restricted to the types the twin uses."""

    type: GeometryType
    coordinates: Any

    @field_validator("coordinates")
    @classmethod
    def _coordinates_not_empty(cls, value: Any) -> Any:
        if value is None or (hasattr(value, "__len__") and len(value) == 0):
            raise ValueError("geometry coordinates must not be empty")
        return value


class Feature(BaseModel):
    """Base class for every typed feature in the twin. `id` is stable across
    versions -- it is what diff.py keys on to detect add/remove/modify."""

    id: str
    layer: LayerName
    geometry: Geometry
    properties: dict[str, Any] = Field(default_factory=dict)


class StreetSegment(Feature):
    layer: Literal["streets"] = "streets"
    feature_code_desc: str | None = None


class Building(Feature):
    layer: Literal["buildings"] = "buildings"
    height_m: float | None = None


class ZoningParcel(Feature):
    layer: Literal["zoning"] = "zoning"
    zone_category: str | None = None


class Park(Feature):
    layer: Literal["parks"] = "parks"
    name: str | None = None


class TransitStop(Feature):
    layer: Literal["transit_stops"] = "transit_stops"
    stop_name: str | None = None
    mode: TransitMode = "other"


class TransitShape(Feature):
    layer: Literal["transit_shapes"] = "transit_shapes"
    shape_id: str | None = None


LAYER_MODELS: dict[LayerName, type[Feature]] = {
    "streets": StreetSegment,
    "buildings": Building,
    "zoning": ZoningParcel,
    "parks": Park,
    "transit_stops": TransitStop,
    "transit_shapes": TransitShape,
}


class PolicyValue(BaseModel):
    """A single named policy value attached to a zone or citywide (`zone_id`
    None). This is the seed of the "policy layer" AGENTS.md 4.1 describes;
    Phase 0 only needs enough of it to test the "taxes only on zones that
    exist" invariant."""

    id: str
    kind: str  # e.g. "parking_tax_pct", "transit_fare"
    zone_id: str | None = None
    value: float


class Edit(BaseModel):
    """One atomic change in a `patch()` call. `patch()` applies a list of
    these to produce a new, versioned TwinState -- see twin/state.py."""

    op: Literal["add", "remove", "modify"]
    layer: LayerName | Literal["policy"]
    feature_id: str
    feature: dict[str, Any] | None = None  # required for add/modify
