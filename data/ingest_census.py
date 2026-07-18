"""Phase 1 ingestion: census-derived population data for the study area.

**Granularity note, flagged explicitly (not a silent substitution):**
`implementation_plan.md` Phase 1 says `population/sampler.py` should draw
"census-weighted personas by dissemination area." True StatCan 2021 DA-level
*attribute* data (income, tenure, commute mode) is only distributed through
an interactive form-driven download tool
(https://www12.statcan.gc.ca/census-recensement/2021/dp-pd/prof/details/download-telecharger.cfm)
or the WDS API, and reverse-engineering a correct, non-guessed bulk-download
URL for it was not a good use of a single overnight session. DA-level
*boundary geometry* is fetchable precisely and boundedly, via StatCan's own
ArcGIS REST MapServer
(https://geo.statcan.gc.ca/geo_wa/rest/services/2021/Cartographic_boundary_files/MapServer/12,
layer "DA - lda_000b21s_e", bbox-queryable) -- but pairing that geometry with
attributes still needs the same blocked download step.

Substitution used instead: the City of Toronto's own 2021-census-derived
**Neighbourhood Profiles** (158-neighbourhood model), fetched through the
same CKAN portal already integrated in `data/ingest.py`. This is still real
StatCan 2021 Census data, just pre-aggregated to a coarser, city-defined
geography (158 neighbourhoods vs. ~600 DAs city-wide) instead of true DAs.
`implementation_plan.md` explicitly says "Start coarse" for Phase 1, which
licenses this substitution for a first pass -- but the geography named in the
plan text was DAs, not neighbourhoods, so this is logged here (and in
OVERNIGHT_LOG.md) as a real, documented deviation for a future session to
either accept or replace with true DA-level data once the StatCan download
path is worked out.

Study area: same Ward 13 "Toronto Centre" + 300m buffer as data/ingest.py.
14 of the city's 158 neighbourhoods overlap it (see `NEIGHBOURHOODS.geojson`
after running this script).
"""

from __future__ import annotations

from pathlib import Path

import geopandas as gpd
import pandas as pd

from data.toronto_ckan import download, find_resource, package_show, write_manifest_entry
from data.ingest import PROCESSED_DIR, RAW_DIR, MANIFEST_PATH, SOURCE_CRS, TARGET_CRS, _study_area_polygon

NEIGHBOURHOODS_PACKAGE = "neighbourhoods"
NEIGHBOURHOODS_RESOURCE = "Neighbourhoods - 4326.geojson"
PROFILES_PACKAGE = "neighbourhood-profiles"
PROFILES_RESOURCE = "neighbourhood-profiles-2021-158-model"

# (output column name, exact row label in the source workbook's first column)
# Labels copied verbatim from the workbook -- leading spaces in the source
# indicate the row is a sub-total under the preceding "Total - ..." header.
# Age-group sub-rows share their exact label text with unrelated rows
# elsewhere in the workbook (e.g. "65 years and over" appears 6 times under
# different section headers), so these are addressed by *position*, as a
# fixed offset from the (unique) "Total - Age groups..." header row, rather
# than by label lookup. Offsets verified against the live workbook.
AGE_HEADER_ROW = "Total - Age groups of the population - 25% sample data"
AGE_ROW_OFFSETS = {
    "pop_total": 0,
    "age_0_14": 1,
    "age_15_64": 5,
    "age_65_plus": 16,
}
MEDIAN_ROWS = {
    "median_age": "Median age of the population",
    "median_total_income": "    Median total income in 2020  among recipients ($)",
}
TENURE_ROWS = {
    "tenure_total": "Total - Private households by tenure - 25% sample data",
    "tenure_owner": "  Owner",
    "tenure_renter": "  Renter",
}
COMMUTE_ROWS = {
    "commute_total": (
        "Total - Main mode of commuting for the employed labour force aged 15 years and over "
        "with a usual place of work or no fixed workplace address - 25% sample data"
    ),
    "commute_car": "  Car, truck or van",
    "commute_transit": "  Public transit",
    "commute_walk": "  Walked",
    "commute_bicycle": "  Bicycle",
    "commute_other": "  Other method",
}
ALL_LABEL_ROWS = {**MEDIAN_ROWS, **TENURE_ROWS, **COMMUTE_ROWS}


def _ingest_neighbourhood_boundaries(mask: gpd.GeoSeries) -> gpd.GeoDataFrame:
    package = package_show(NEIGHBOURHOODS_PACKAGE)
    resource = find_resource(package, NEIGHBOURHOODS_RESOURCE)
    raw_path = download(resource["url"], RAW_DIR / "neighbourhoods_4326.geojson")
    gdf = gpd.read_file(raw_path)
    n_before = len(gdf)
    if gdf.crs is None:
        gdf = gdf.set_crs(SOURCE_CRS)
    clipped = gpd.clip(gdf, mask.to_crs(gdf.crs))
    clipped = clipped.to_crs(TARGET_CRS)
    out_path = PROCESSED_DIR / "neighbourhoods.geojson"
    clipped.to_file(out_path, driver="GeoJSON")
    write_manifest_entry(
        MANIFEST_PATH,
        {
            "layer": "neighbourhoods",
            "dataset_id": NEIGHBOURHOODS_PACKAGE,
            "dataset_title": package.get("title"),
            "resource_id": resource.get("id"),
            "resource_url": resource.get("url"),
            "license": package.get("license_title"),
            "rows_before_clip": n_before,
            "rows_after_clip": len(clipped),
            "target_crs": TARGET_CRS,
        },
    )
    print(f"[neighbourhoods] {n_before} -> {len(clipped)} features, written to {out_path}")
    return clipped


def _ingest_census_profile(neighbourhood_codes: set[str]) -> pd.DataFrame:
    package = package_show(PROFILES_PACKAGE)
    resource = find_resource(package, PROFILES_RESOURCE)
    raw_path = download(resource["url"], RAW_DIR / "neighbourhood_profiles_2021.xlsx")
    raw = pd.read_excel(raw_path, sheet_name=0)
    label_col = raw["Neighbourhood Name"].astype(str)
    age_header_pos = label_col[label_col == AGE_HEADER_ROW].index[0]

    wide = raw.set_index("Neighbourhood Name")
    # Column headers are neighbourhood *names*; the "Neighbourhood Number" row
    # gives each column's numeric code, which is what AREA_SHORT_CODE in the
    # boundary layer also uses (zero-padded there).
    codes_row = wide.loc["Neighbourhood Number"]

    records = []
    for col_name, code in codes_row.items():
        code_str = f"{int(code):03d}"
        if code_str not in neighbourhood_codes:
            continue
        record = {"AREA_SHORT_CODE": code_str, "neighbourhood_name": col_name}
        for out_col, offset in AGE_ROW_OFFSETS.items():
            value = raw.at[age_header_pos + offset, col_name]
            record[out_col] = pd.to_numeric(value, errors="coerce")
        for out_col, row_label in ALL_LABEL_ROWS.items():
            value = wide.loc[row_label, col_name] if row_label in wide.index else None
            record[out_col] = pd.to_numeric(value, errors="coerce")
        records.append(record)

    profile = pd.DataFrame.from_records(records)
    out_path = PROCESSED_DIR / "census_profile.csv"
    profile.to_csv(out_path, index=False)
    write_manifest_entry(
        MANIFEST_PATH,
        {
            "layer": "census_profile",
            "dataset_id": PROFILES_PACKAGE,
            "dataset_title": package.get("title"),
            "resource_id": resource.get("id"),
            "resource_url": resource.get("url"),
            "license": package.get("license_title"),
            "rows_after_clip": len(profile),
            "note": (
                "Substitutes StatCan 2021 census profile aggregated to City of "
                "Toronto's 158-neighbourhood geography for true dissemination-area "
                "granularity named in implementation_plan.md Phase 1; see module "
                "docstring in data/ingest_census.py."
            ),
        },
    )
    print(f"[census_profile] {len(profile)} neighbourhoods, written to {out_path}")
    return profile


def main() -> None:
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    mask = _study_area_polygon()
    neighbourhoods = _ingest_neighbourhood_boundaries(mask)
    codes = set(neighbourhoods["AREA_SHORT_CODE"].astype(str))
    _ingest_census_profile(codes)


if __name__ == "__main__":
    main()
