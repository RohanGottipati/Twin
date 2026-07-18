"""Basic sanity checks on TwinState.load_from_processed against the real
ingested Ward 13 slice."""

from __future__ import annotations

from twin.state import TwinState


def test_base_state_is_version_zero_with_no_parent(base_state: TwinState):
    assert base_state.version == 0
    assert base_state.parent_version is None
    assert base_state.edits_applied == ()


def test_base_state_has_all_layers_populated(base_state: TwinState):
    for layer in ("streets", "buildings", "zoning", "parks", "transit_stops", "transit_shapes"):
        features = base_state.all_features(layer)
        assert len(features) > 0, f"layer {layer} is empty"


def test_feature_ids_are_unique_within_each_layer(base_state: TwinState):
    for layer, features in base_state.layers.items():
        ids = [f.id for f in features.values()]
        assert len(ids) == len(set(ids)), f"duplicate ids in layer {layer}"


def test_to_geoseries_returns_geometries_in_target_crs(base_state: TwinState):
    from twin.schema import CRS

    gs = base_state.to_geoseries("transit_stops")
    assert gs.crs is not None
    assert gs.crs.to_string() == CRS
    assert len(gs) == len(base_state.all_features("transit_stops"))
