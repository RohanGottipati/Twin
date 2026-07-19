"""Build public/data/home-sites.json: residential building centroids by neighbourhood.

Sources:
  - Toronto 3D Massing (citywide building footprints)
  - Toronto Zoning By-law (keep buildings in R/RD/RS/RM/RA/RT/RAC/CR/CRE)

Dots on the map then sit on buildings in residential (or mixed-res) zones,
not parks / water / industrial lots.
"""

from __future__ import annotations

import json
import urllib.request
from pathlib import Path

import geopandas as gpd
from shapely.geometry import Point

ROOT = Path(__file__).resolve().parents[2]
RAW_MASSING = ROOT / "data" / "raw" / "massing_2025_wgs84.zip"
RAW_ZONING = ROOT / "data" / "raw" / "zoning_area_4326.geojson"
NBHD = ROOT / "public" / "data" / "neighbourhoods.geojson"
OUT = ROOT / "public" / "data" / "home-sites.json"
OUT_ZONING = ROOT / "data" / "processed" / "zoning_citywide.geojson"

MASSING_URL = (
    "https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/"
    "387b2e3b-2a76-4199-8b3b-0b7d22e2ec10/resource/"
    "667237d6-4d3c-4cf3-8cb7-e91c48d59375/download/3dmassingshapefile_2025_wgs84.zip"
)
ZONING_URL = (
    "https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/"
    "34927e44-fc11-4336-a8aa-a0dfb27658b7/resource/"
    "d75fa1ed-cd04-4a0b-bb6d-2b928ffffa6e/download/zoning-area-4326.geojson"
)

# residential + mixed-use that includes housing
RES_ZONES = {"R", "RD", "RS", "RM", "RA", "RT", "RAC", "CR", "CRE"}


def _ensure(path: Path, url: str, min_bytes: int = 1_000_000) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists() or path.stat().st_size < min_bytes:
        print(f"downloading {path.name}…")
        urllib.request.urlretrieve(url, path)


def main() -> None:
    _ensure(RAW_MASSING, MASSING_URL)
    _ensure(RAW_ZONING, ZONING_URL)

    print("loading zoning…")
    zoning = gpd.read_file(RAW_ZONING)
    res = zoning[zoning["ZN_ZONE"].astype(str).isin(RES_ZONES)].copy()
    res_out = res[["ZN_ZONE", "GEN_ZONE", "geometry"]].to_crs("EPSG:4326")
    OUT_ZONING.parent.mkdir(parents=True, exist_ok=True)
    res_out.to_file(OUT_ZONING, driver="GeoJSON")
    print(f"residential zoning polys={len(res_out)}")

    print("loading buildings…")
    gdf = gpd.read_file(f"/vsizip/{RAW_MASSING.resolve()}")
    pts = gpd.GeoDataFrame(
        geometry=[Point(xy) for xy in zip(gdf["LONGITUDE"], gdf["LATITUDE"])],
        crs="EPSG:4326",
    )

    print("filter to residential zoning…")
    res_diss = res_out.dissolve().reset_index(drop=True)
    in_res = gpd.sjoin(pts, res_diss[["geometry"]], how="inner", predicate="within")
    print(f"buildings in res zones={len(in_res)} / {len(pts)}")

    print("join neighbourhoods…")
    nbhd = gpd.read_file(NBHD)[["code", "geometry"]].to_crs("EPSG:4326")
    joined = gpd.sjoin(in_res[["geometry"]], nbhd, how="inner", predicate="within")

    homes: dict[str, list[list[float]]] = {}
    for code, grp in joined.groupby("code"):
        homes[str(code)] = [[float(x), float(y)] for x, y in zip(grp.geometry.x, grp.geometry.y)]

    # rare industrial/park-heavy nbhds: fall back to any building rather than parks
    missing = [str(c) for c in nbhd["code"] if str(c) not in homes]
    if missing:
        all_joined = gpd.sjoin(pts, nbhd, how="inner", predicate="within")
        for code in missing:
            grp = all_joined[all_joined["code"].astype(str) == code]
            print(f"fallback any-building for nbhd {code}: n={len(grp)}")
            if len(grp):
                homes[code] = [[float(x), float(y)] for x, y in zip(grp.geometry.x, grp.geometry.y)]

    OUT.write_text(json.dumps(homes, separators=(",", ":")))
    print(f"wrote {OUT} nbhds={len(homes)} sites={sum(map(len, homes.values()))}")


if __name__ == "__main__":
    main()
