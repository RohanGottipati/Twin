"""Sanity checks on the bounded, reprojected slice written by data/ingest.py.
Reads the committed data/processed/ files directly (no network access), so
these run offline and fast."""

from __future__ import annotations

import json
from pathlib import Path

import geopandas as gpd
import pytest

PROCESSED_DIR = Path(__file__).resolve().parent.parent / "data" / "processed"

LAYER_FILES = [
    "streets.geojson",
    "buildings.geojson",
    "zoning.geojson",
    "parks.geojson",
    "transit_stops.geojson",
    "transit_shapes.geojson",
    "study_area.geojson",
]


@pytest.mark.parametrize("filename", LAYER_FILES)
def test_layer_file_exists_and_nonempty(filename: str):
    path = PROCESSED_DIR / filename
    assert path.exists(), f"{path} missing -- run `uv run python -m data.ingest`"
    gdf = gpd.read_file(path)
    assert len(gdf) > 0, f"{filename} has no features"


@pytest.mark.parametrize("filename", LAYER_FILES)
def test_layer_reprojected_to_utm17n(filename: str):
    gdf = gpd.read_file(PROCESSED_DIR / filename)
    assert gdf.crs is not None
    assert gdf.crs.to_epsg() == 26917, f"{filename} is in {gdf.crs}, expected EPSG:26917"


def test_layers_are_bounded_not_citywide():
    """A processed layer restricted to one ward + buffer should be orders of
    magnitude smaller than city-wide Toronto (roughly 630 sq km); a bounding
    box under 20 sq km confirms we didn't accidentally ship the raw citywide
    download."""
    gdf = gpd.read_file(PROCESSED_DIR / "study_area.geojson")
    minx, miny, maxx, maxy = gdf.total_bounds
    area_km2 = (maxx - minx) * (maxy - miny) / 1e6
    assert 0 < area_km2 < 20, f"study area bounding box is {area_km2:.1f} km^2, expected a small bounded slice"


def test_manifest_has_provenance_for_every_source_layer():
    manifest_path = PROCESSED_DIR / "manifest.jsonl"
    assert manifest_path.exists()
    entries = [json.loads(line) for line in manifest_path.read_text().splitlines() if line.strip()]
    layers_logged = {e["layer"] for e in entries}
    assert {"streets", "zoning", "parks", "buildings"} <= layers_logged
    for entry in entries:
        assert entry.get("dataset_id"), entry
        assert entry.get("resource_url", "").startswith("https://"), entry
