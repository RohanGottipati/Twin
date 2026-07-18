"""Versioned city twin state: load, snapshot, and patch.

`TwinState` is immutable once constructed. `patch()` never mutates a state in
place -- it validates a proposed set of edits against `twin/invariants.py`
and either returns a brand-new, incremented-version `TwinState`, or raises
`TwinInvariantError` and leaves the caller's original state untouched. That
atomicity (validate-then-commit, never partially-applied) is what makes the
compiler safe for a general `patch(edits)` verb per AGENTS.md 4.1/4.2.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any

import geopandas as gpd
from shapely.geometry import mapping, shape

from twin.schema import CRS, LAYER_MODELS, Edit, Feature, LayerName, PolicyValue

PROCESSED_DIR_DEFAULT = Path(__file__).resolve().parent.parent / "data" / "processed"

# Column -> typed-field mapping per layer, from the raw processed GeoDataFrame
# columns (see data/ingest.py) to the extra fields each Feature subclass in
# twin/schema.py declares beyond the common `properties` bag.
_ID_COLUMNS: dict[LayerName, str | None] = {
    "streets": "CENTRELINE_ID",
    "buildings": None,  # no natural id in the source; row index is used
    "zoning": "_id",
    "parks": "ASSET_ID",
    "transit_stops": "stop_id",
    "transit_shapes": "shape_id",
}


class TwinInvariantError(Exception):
    """Raised by patch() when a proposed edit set violates an invariant.
    Carries the full list of violations found (see twin/invariants.py)."""

    def __init__(self, violations: list[str]):
        self.violations = violations
        super().__init__("; ".join(violations))


def _row_to_feature(layer: LayerName, feature_id: str, row: dict[str, Any]) -> Feature:
    geom = row.pop("geometry")
    geometry_dict = mapping(geom)
    model = LAYER_MODELS[layer]
    extra: dict[str, Any] = {}
    if layer == "buildings":
        extra["height_m"] = row.get("MAX_HEIGHT")
    elif layer == "zoning":
        raw_category = row.get("GEN_ZONE") or row.get("ZN_ZONE")
        extra["zone_category"] = str(raw_category) if raw_category is not None else None
    elif layer == "parks":
        extra["name"] = row.get("ASSET_NAME")
    elif layer == "streets":
        extra["feature_code_desc"] = row.get("FEATURE_CODE_DESC")
    elif layer == "transit_stops":
        extra["stop_name"] = row.get("stop_name")
    elif layer == "transit_shapes":
        extra["shape_id"] = row.get("shape_id")
    return model(
        id=feature_id,
        geometry={"type": geometry_dict["type"], "coordinates": geometry_dict["coordinates"]},
        properties={k: v for k, v in row.items() if v is not None},
        **extra,
    )


@dataclass(frozen=True)
class TwinState:
    layers: dict[LayerName, dict[str, Feature]]
    policies: dict[str, PolicyValue]
    version: int
    parent_version: int | None
    edits_applied: tuple[Edit, ...] = field(default_factory=tuple)

    # ---- construction -----------------------------------------------------

    @classmethod
    def load_from_processed(cls, processed_dir: Path | None = None) -> "TwinState":
        """Load version 0 of the twin from `data/processed/*.geojson`
        (the bounded, reprojected slice written by `data/ingest.py`)."""
        processed_dir = processed_dir or PROCESSED_DIR_DEFAULT
        layers: dict[LayerName, dict[str, Feature]] = {}
        for layer, id_col in _ID_COLUMNS.items():
            path = processed_dir / f"{'transit_stops' if layer == 'transit_stops' else layer}.geojson"
            if not path.exists():
                layers[layer] = {}
                continue
            gdf = gpd.read_file(path)
            if gdf.crs is None or gdf.crs.to_string() != CRS:
                gdf = gdf.set_crs(CRS, allow_override=gdf.crs is None) if gdf.crs is None else gdf.to_crs(CRS)
            features: dict[str, Feature] = {}
            for idx, row in enumerate(gdf.to_dict("records")):
                if id_col and row.get(id_col) is not None:
                    feature_id = f"{layer}:{row[id_col]}"
                else:
                    feature_id = f"{layer}:{idx}"
                feat = _row_to_feature(layer, feature_id, dict(row))
                features[feature_id] = feat
            layers[layer] = features
        return cls(layers=layers, policies={}, version=0, parent_version=None)

    # ---- read access --------------------------------------------------

    def get(self, layer: LayerName, feature_id: str) -> Feature | None:
        return self.layers.get(layer, {}).get(feature_id)

    def all_features(self, layer: LayerName) -> list[Feature]:
        return list(self.layers.get(layer, {}).values())

    def to_geoseries(self, layer: LayerName) -> gpd.GeoSeries:
        """Shapely geometries for every feature in `layer`, for spatial
        invariant checks (proximity, connectivity)."""
        feats = self.all_features(layer)
        geoms = [shape(f.geometry.model_dump()) for f in feats]
        ids = [f.id for f in feats]
        return gpd.GeoSeries(geoms, index=ids, crs=CRS)

    def feature_count(self) -> int:
        return sum(len(v) for v in self.layers.values())

    # ---- mutation (internal; use patch() for the validated public path) ---

    def _apply_edits_unchecked(self, edits: list[Edit]) -> "TwinState":
        new_layers = {layer: dict(features) for layer, features in self.layers.items()}
        new_policies = dict(self.policies)

        for edit in edits:
            if edit.layer == "policy":
                if edit.op == "remove":
                    new_policies.pop(edit.feature_id, None)
                else:
                    if edit.feature is None:
                        raise ValueError(f"edit {edit} of op={edit.op} requires `feature`")
                    new_policies[edit.feature_id] = PolicyValue(id=edit.feature_id, **edit.feature)
                continue

            layer: LayerName = edit.layer  # type: ignore[assignment]
            bucket = new_layers.setdefault(layer, {})
            if edit.op == "remove":
                bucket.pop(edit.feature_id, None)
            elif edit.op == "add":
                if edit.feature is None:
                    raise ValueError(f"edit {edit} of op={edit.op} requires `feature`")
                model = LAYER_MODELS[layer]
                payload = dict(edit.feature)
                payload.setdefault("id", edit.feature_id)
                payload.setdefault("layer", layer)
                bucket[edit.feature_id] = model(**payload)
            else:  # modify: merge onto the existing feature, if any
                if edit.feature is None:
                    raise ValueError(f"edit {edit} of op={edit.op} requires `feature`")
                model = LAYER_MODELS[layer]
                existing = bucket.get(edit.feature_id)
                base = existing.model_dump() if existing is not None else {}
                base.update(edit.feature)
                base.setdefault("id", edit.feature_id)
                base.setdefault("layer", layer)
                bucket[edit.feature_id] = model(**base)

        return replace(
            self,
            layers=new_layers,
            policies=new_policies,
            version=self.version + 1,
            parent_version=self.version,
            edits_applied=tuple(edits),
        )


def patch(state: TwinState, edits: list[Edit]) -> TwinState:
    """The one validated mutation path for the twin (AGENTS.md 4.2 `patch`).

    Applies `edits` on top of `state`, runs every invariant in
    twin/invariants.py against the *resulting* state, and either returns the
    new, versioned TwinState (on success) or raises TwinInvariantError and
    leaves `state` completely unaffected (on failure). Never partially
    applies a patch.
    """
    from twin.invariants import check_all  # local import: avoids a cycle with state.py

    candidate = state._apply_edits_unchecked(edits)
    violations = check_all(candidate)
    if violations:
        raise TwinInvariantError(violations)
    return candidate
