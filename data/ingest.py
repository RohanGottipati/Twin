"""Phase 0 ingestion: a bounded slice of Toronto open data into `data/processed/`.

Study area: Ward 13, "Toronto Centre" (25-ward model, current as of 2026-07-17).
Chosen because it contains the downtown financial district, Union Station, and
the University-Yonge subway spine plus a dense streetcar grid -- i.e. the
densest, most topologically interesting transit network in the city, which
gives later phases (effect-graph commute deltas, opinion heterogeneity across
a bundled tram+tax policy) real structure to work with. A quieter suburban
ward would make Phase 0's invariant checks trivially pass without exercising
real network complexity.

Pipeline, per layer:
  1. Download the citywide source resource from CKAN (see `toronto_ckan.py`)
     into `data/raw/` if not already present. These sources are citywide
     because Toronto Open Data does not expose a server-side bbox-filtered
     download for most of these layers; `data/raw/` is git-ignored.
  2. Clip to the study-area polygon (Ward 13 boundary buffered by
     `BUFFER_M` metres, so streets/stops that cross the ward edge aren't
     truncated mid-block).
  3. Reproject to NAD83 / UTM zone 17N (EPSG:26917), the plan's mandated CRS.
  4. Write the small, bounded result to `data/processed/<layer>.geojson`,
     which IS committed -- that bounded file is the actual twin input.

A JSON-lines provenance manifest is written to `data/processed/manifest.jsonl`
recording dataset id, resource id, source URL, and row counts before/after
clipping for every layer.

Run: `uv run python -m data.ingest`
"""

from __future__ import annotations

import json
import zipfile
from pathlib import Path

import geopandas as gpd
import pandas as pd
from shapely.geometry import Point

from data.toronto_ckan import download, find_resource, package_show, write_manifest_entry

REPO_ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = REPO_ROOT / "data" / "raw"
PROCESSED_DIR = REPO_ROOT / "data" / "processed"
MANIFEST_PATH = PROCESSED_DIR / "manifest.jsonl"

SOURCE_CRS = "EPSG:4326"
TARGET_CRS = "EPSG:26917"  # NAD83 / UTM zone 17N, per implementation_plan.md Phase 0
BUFFER_M = 300.0
STUDY_WARD_NAME = "Toronto Centre"

# package_id, resource_name pairs verified live against the CKAN API on 2026-07-17.
VECTOR_LAYERS = {
    "wards": ("city-wards", "City Wards Data - 4326.geojson"),
    "streets": ("toronto-centreline-tcl", "Centreline - Version 2 - 4326.geojson"),
    "zoning": ("zoning-by-law", "Zoning Area - 4326.geojson"),
    "parks": ("parks-and-recreation-facilities", "Parks and Recreation Facilities - 4326.geojson"),
}
MASSING_PACKAGE = "3d-massing"
MASSING_RESOURCE = "3DMassingShapefile_2025_WGS84.zip"
GTFS_PACKAGE = "ttc-routes-and-schedules"
GTFS_RESOURCE = "TTC Routes and Schedules Data"


def _study_area_polygon() -> gpd.GeoSeries:
    """Ward 13 boundary, buffered BUFFER_M metres, back in SOURCE_CRS for clipping."""
    package = package_show("city-wards")
    resource = find_resource(package, VECTOR_LAYERS["wards"][1])
    raw_path = download(resource["url"], RAW_DIR / "city_wards_4326.geojson")
    wards = gpd.read_file(raw_path)
    ward = wards[wards["AREA_NAME"] == STUDY_WARD_NAME]
    if ward.empty:
        raise RuntimeError(f"Ward {STUDY_WARD_NAME!r} not found in city-wards dataset")
    buffered = ward.to_crs(TARGET_CRS).buffer(BUFFER_M)
    return gpd.GeoSeries(buffered, crs=TARGET_CRS).to_crs(SOURCE_CRS)


def _clip_and_reproject(gdf: gpd.GeoDataFrame, mask: gpd.GeoSeries) -> gpd.GeoDataFrame:
    if gdf.crs is None:
        gdf = gdf.set_crs(SOURCE_CRS)
    elif gdf.crs.to_string() != SOURCE_CRS:
        gdf = gdf.to_crs(SOURCE_CRS)
    clipped = gpd.clip(gdf, mask)
    return clipped.to_crs(TARGET_CRS)


def _ingest_vector_layer(layer: str, mask: gpd.GeoSeries) -> None:
    package_id, resource_name = VECTOR_LAYERS[layer]
    package = package_show(package_id)
    resource = find_resource(package, resource_name)
    raw_path = download(resource["url"], RAW_DIR / f"{layer}_4326.geojson")
    gdf = gpd.read_file(raw_path)
    n_before = len(gdf)
    clipped = _clip_and_reproject(gdf, mask)
    out_path = PROCESSED_DIR / f"{layer}.geojson"
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    clipped.to_file(out_path, driver="GeoJSON")
    write_manifest_entry(
        MANIFEST_PATH,
        {
            "layer": layer,
            "dataset_id": package_id,
            "dataset_title": package.get("title"),
            "resource_id": resource.get("id"),
            "resource_url": resource.get("url"),
            "license": package.get("license_title"),
            "rows_before_clip": n_before,
            "rows_after_clip": len(clipped),
            "target_crs": TARGET_CRS,
        },
    )
    print(f"[{layer}] {n_before} -> {len(clipped)} features, written to {out_path}")


def _ingest_massing(mask: gpd.GeoSeries) -> None:
    package = package_show(MASSING_PACKAGE)
    resource = find_resource(package, MASSING_RESOURCE)
    raw_path = download(resource["url"], RAW_DIR / "massing_2025_wgs84.zip")
    gdf = gpd.read_file(f"/vsizip/{raw_path}")
    n_before = len(gdf)
    clipped = _clip_and_reproject(gdf, mask)
    out_path = PROCESSED_DIR / "buildings.geojson"
    clipped.to_file(out_path, driver="GeoJSON")
    write_manifest_entry(
        MANIFEST_PATH,
        {
            "layer": "buildings",
            "dataset_id": MASSING_PACKAGE,
            "dataset_title": package.get("title"),
            "resource_id": resource.get("id"),
            "resource_url": resource.get("url"),
            "license": package.get("license_title"),
            "rows_before_clip": n_before,
            "rows_after_clip": len(clipped),
            "target_crs": TARGET_CRS,
        },
    )
    print(f"[buildings] {n_before} -> {len(clipped)} features, written to {out_path}")


def _ingest_gtfs(mask: gpd.GeoSeries) -> None:
    """Parse stops.txt + routes.txt + trips.txt + shapes.txt from the GTFS
    feed. `stop_times.txt` (~200MB uncompressed) is intentionally NOT parsed
    in Phase 0: nothing in the Phase 0 gate (network-membership invariants,
    patch/diff) needs per-departure schedule rows, only stop geometry and
    route shapes. Revisit when schedule-based features are needed (Phase 3+).
    """
    package = package_show(GTFS_PACKAGE)
    resource = find_resource(package, GTFS_RESOURCE)
    raw_path = download(resource["url"], RAW_DIR / "gtfs.zip")
    zf = zipfile.ZipFile(raw_path)

    with zf.open("stops.txt") as f:
        stops = pd.read_csv(f, dtype={"stop_id": str, "parent_station": str})
    n_stops_before = len(stops)
    stops_gdf = gpd.GeoDataFrame(
        stops,
        geometry=[Point(xy) for xy in zip(stops["stop_lon"], stops["stop_lat"])],
        crs=SOURCE_CRS,
    )
    stops_clipped = _clip_and_reproject(stops_gdf, mask)
    stops_path = PROCESSED_DIR / "transit_stops.geojson"
    stops_clipped.to_file(stops_path, driver="GeoJSON")
    print(f"[transit_stops] {n_stops_before} -> {len(stops_clipped)} features, written to {stops_path}")

    with zf.open("routes.txt") as f:
        routes = pd.read_csv(f, dtype=str)
    routes_path = PROCESSED_DIR / "transit_routes.csv"
    routes.to_csv(routes_path, index=False)
    print(f"[transit_routes] {len(routes)} routes (citywide, small; not spatially clipped), written to {routes_path}")

    with zf.open("trips.txt") as f:
        trips = pd.read_csv(f, dtype=str)
    kept_route_ids = set(routes["route_id"])
    trips = trips[trips["route_id"].isin(kept_route_ids)]

    with zf.open("shapes.txt") as f:
        shapes = pd.read_csv(f, dtype={"shape_id": str})
    kept_shape_ids = set(trips["shape_id"].dropna().unique())
    shapes = shapes[shapes["shape_id"].isin(kept_shape_ids)]
    shapes = shapes.sort_values(["shape_id", "shape_pt_sequence"])
    n_shapes_before = shapes["shape_id"].nunique()

    from shapely.geometry import LineString

    lines = []
    shape_ids = []
    for shape_id, group in shapes.groupby("shape_id"):
        if len(group) < 2:
            continue
        lines.append(LineString(zip(group["shape_pt_lon"], group["shape_pt_lat"])))
        shape_ids.append(shape_id)
    shapes_gdf = gpd.GeoDataFrame({"shape_id": shape_ids}, geometry=lines, crs=SOURCE_CRS)
    shapes_clipped = _clip_and_reproject(shapes_gdf, mask)
    shapes_path = PROCESSED_DIR / "transit_shapes.geojson"
    shapes_clipped.to_file(shapes_path, driver="GeoJSON")
    print(f"[transit_shapes] {n_shapes_before} -> {len(shapes_clipped)} shapes, written to {shapes_path}")

    write_manifest_entry(
        MANIFEST_PATH,
        {
            "layer": "transit_stops+routes+shapes",
            "dataset_id": GTFS_PACKAGE,
            "dataset_title": package.get("title"),
            "resource_id": resource.get("id"),
            "resource_url": resource.get("url"),
            "license": package.get("license_title"),
            "rows_before_clip": n_stops_before,
            "rows_after_clip": len(stops_clipped),
            "target_crs": TARGET_CRS,
            "note": "stop_times.txt intentionally not parsed in Phase 0",
        },
    )


def main() -> None:
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    if MANIFEST_PATH.exists():
        MANIFEST_PATH.unlink()

    mask = _study_area_polygon()

    # Write the study-area polygon itself as a processed layer for reference.
    study_area_path = PROCESSED_DIR / "study_area.geojson"
    mask.to_crs(TARGET_CRS).to_frame("geometry").to_file(study_area_path, driver="GeoJSON")
    print(f"[study_area] Ward {STUDY_WARD_NAME!r} + {BUFFER_M}m buffer, written to {study_area_path}")

    for layer in ("streets", "zoning", "parks"):
        _ingest_vector_layer(layer, mask)
    _ingest_massing(mask)
    _ingest_gtfs(mask)

    print(f"\nManifest written to {MANIFEST_PATH}")


if __name__ == "__main__":
    main()
