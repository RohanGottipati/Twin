"""Census-derived population data, city-wide (all 158 neighbourhoods).

**Granularity note, flagged explicitly (not a silent substitution):**
True StatCan 2021 DA-level *attribute* data (income, tenure, commute mode) is
only distributed through an interactive form-driven download tool
(https://www12.statcan.gc.ca/census-recensement/2021/dp-pd/prof/details/download-telecharger.cfm)
or the WDS API, and reverse-engineering a correct, non-guessed bulk-download
URL for it remains out of scope. DA-level *boundary geometry* is fetchable
precisely and boundedly, via StatCan's own ArcGIS REST MapServer
(https://geo.statcan.gc.ca/geo_wa/rest/services/2021/Cartographic_boundary_files/MapServer/12,
layer "DA - lda_000b21s_e", bbox-queryable) -- but pairing that geometry with
attributes still needs the same blocked download step.

Substitution used instead: the City of Toronto's own 2021-census-derived
**Neighbourhood Profiles** (158-neighbourhood model), fetched through the
same CKAN portal already integrated in `data/ingest.py`. This is still real
StatCan 2021 Census data, just pre-aggregated to a coarser, city-defined
geography (158 neighbourhoods vs. ~600 DAs city-wide) instead of true DAs.

**Scope, 2026-07-18 update:** earlier sessions clipped this to the 14
neighbourhoods overlapping Ward 13 (the twin's original study area). Per
explicit user direction, persona generation now targets realistic,
representative residents across all of Toronto, not just that slice -- this
module now ingests full city-wide neighbourhood boundaries and census
profiles for all 158 neighbourhoods, independent of the Ward-13-clipped twin
(which still only has Ward-13 buildings; building/home-location placement is
being reworked separately since it's out of scope for persona *attribute*
realism).
"""

from __future__ import annotations

import geopandas as gpd
import pandas as pd

from data.toronto_ckan import download, find_resource, package_show, write_manifest_entry
from data.ingest import PROCESSED_DIR, RAW_DIR, MANIFEST_PATH, SOURCE_CRS, TARGET_CRS

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

# Additional richer marginals (2026-07-18 city-wide expansion), all verified
# unique row labels in the live workbook -- see the header-anchored offset
# blocks below for labels that repeat elsewhere in the sheet (age-groups
# style duplication) and therefore need position-based addressing instead.
INCOME_DECILE_HEADER_ROW = (
    "Total - Adjusted after-tax family income decile group for the population "
    "in private households - 25% sample data"
)
INCOME_DECILE_OFFSETS = {
    "income_decile_total": 0,
    "income_bottom_half": 1,
    "income_decile_1": 2,
    "income_decile_2": 3,
    "income_decile_3": 4,
    "income_decile_4": 5,
    "income_decile_5": 6,
    "income_top_half": 7,
    "income_decile_6": 8,
    "income_decile_7": 9,
    "income_decile_8": 10,
    "income_decile_9": 11,
    "income_decile_10": 12,
}

EDUCATION_HEADER_ROW = (
    "Total - Highest certificate, diploma or degree for the population aged 15 "
    "years and over in private households - 25% sample data"
)
EDUCATION_OFFSETS = {
    "education_total": 0,
    "education_none": 1,
    "education_hs_diploma": 2,
    "education_postsecondary": 3,
    "education_postsecondary_below_bachelor": 4,
    "education_bachelor_or_higher": 10,
    "education_bachelor_degree": 11,
}

IMMIGRATION_HEADER_ROW = (
    "Total - Immigrant status and period of immigration for the population "
    "in private households - 25% sample data"
)
IMMIGRATION_OFFSETS = {
    "immigration_total": 0,
    "immigration_non_immigrant": 1,
    "immigration_immigrant": 2,
    "immigration_non_permanent_resident": 10,
}

GENERATION_HEADER_ROW = "Total - Generation status for the population in private households - 25% sample data"
GENERATION_OFFSETS = {
    "generation_total": 0,
    "generation_first": 1,
    "generation_second": 2,
    "generation_third_plus": 3,
}

VISIBLE_MINORITY_HEADER_ROW = "Total - Visible minority for the population in private households - 25% sample data"
VISIBLE_MINORITY_OFFSETS = {
    "vismin_total": 0,
    "vismin_total_visible_minority": 1,
    "vismin_south_asian": 2,
    "vismin_chinese": 3,
    "vismin_black": 4,
    "vismin_filipino": 5,
    "vismin_arab": 6,
    "vismin_latin_american": 7,
    "vismin_southeast_asian": 8,
    "vismin_west_asian": 9,
    "vismin_korean": 10,
    "vismin_japanese": 11,
    "vismin_other": 12,
    "vismin_multiple": 13,
    "vismin_not_visible_minority": 14,
}

MOTHER_TONGUE_HEADER_ROW = "Total - Mother tongue for the population in private households - 25% sample data"
MOTHER_TONGUE_OFFSETS = {
    "mother_tongue_total": 0,
    "mother_tongue_single_response": 1,
    "mother_tongue_official_languages": 2,
    "mother_tongue_english": 3,
    "mother_tongue_french": 4,
}

DWELLING_HEADER_ROW = (
    "Total - Occupied private dwellings by structural type of dwelling - 25% sample data"
)
DWELLING_OFFSETS = {
    "dwelling_total": 0,
    "dwelling_single_detached": 1,
    "dwelling_semi_detached": 2,
    "dwelling_row_house": 3,
    "dwelling_duplex_apartment": 4,
    "dwelling_apartment_lt5_storeys": 5,
    "dwelling_apartment_ge5_storeys": 6,
    "dwelling_other_single_attached": 7,
    "dwelling_movable": 8,
}

HOUSEHOLD_TYPE_HEADER_ROW = "Total - Household type - 25% sample data"
HOUSEHOLD_TYPE_OFFSETS = {
    "household_type_total": 0,
    "household_one_family_no_additional": 1,
    "household_couple_family": 2,
    "household_couple_with_children": 3,
    "household_couple_without_children": 4,
    "household_one_parent_family": 5,
    "household_multigenerational": 6,
    "household_multiple_family": 7,
    "household_one_family_with_additional": 8,
    "household_two_plus_non_family": 9,
    "household_one_person": 10,
}

# Every (header_row_label, offsets_dict) pair to extract by anchor position.
HEADER_ANCHORED_BLOCKS = [
    (INCOME_DECILE_HEADER_ROW, INCOME_DECILE_OFFSETS),
    (EDUCATION_HEADER_ROW, EDUCATION_OFFSETS),
    (IMMIGRATION_HEADER_ROW, IMMIGRATION_OFFSETS),
    (GENERATION_HEADER_ROW, GENERATION_OFFSETS),
    (VISIBLE_MINORITY_HEADER_ROW, VISIBLE_MINORITY_OFFSETS),
    (MOTHER_TONGUE_HEADER_ROW, MOTHER_TONGUE_OFFSETS),
    (DWELLING_HEADER_ROW, DWELLING_OFFSETS),
    (HOUSEHOLD_TYPE_HEADER_ROW, HOUSEHOLD_TYPE_OFFSETS),
]

ALL_LABEL_ROWS = {**MEDIAN_ROWS, **TENURE_ROWS, **COMMUTE_ROWS}


def _ingest_neighbourhood_boundaries() -> gpd.GeoDataFrame:
    """Full city-wide boundaries for all 158 social-planning neighbourhoods
    -- no study-area clip. Persona generation targets all of Toronto now."""
    package = package_show(NEIGHBOURHOODS_PACKAGE)
    resource = find_resource(package, NEIGHBOURHOODS_RESOURCE)
    raw_path = download(resource["url"], RAW_DIR / "neighbourhoods_4326.geojson")
    gdf = gpd.read_file(raw_path)
    n_before = len(gdf)
    if gdf.crs is None:
        gdf = gdf.set_crs(SOURCE_CRS)
    reprojected = gdf.to_crs(TARGET_CRS)
    out_path = PROCESSED_DIR / "neighbourhoods.geojson"
    reprojected.to_file(out_path, driver="GeoJSON")
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
            "rows_after_clip": len(reprojected),
            "target_crs": TARGET_CRS,
            "note": "City-wide, unclipped: all 158 social-planning neighbourhoods.",
        },
    )
    print(f"[neighbourhoods] {n_before} -> {len(reprojected)} features, written to {out_path}")
    return reprojected


def _ingest_census_profile() -> pd.DataFrame:
    """City-wide census profile for all 158 neighbourhoods, including the
    core Phase-1 marginals (age, tenure, commute) plus the richer marginals
    added for city-wide persona realism (income deciles, education,
    immigration/generation status, visible minority, mother tongue, dwelling
    type, household type)."""
    package = package_show(PROFILES_PACKAGE)
    resource = find_resource(package, PROFILES_RESOURCE)
    raw_path = download(resource["url"], RAW_DIR / "neighbourhood_profiles_2021.xlsx")
    raw = pd.read_excel(raw_path, sheet_name=0)
    label_col = raw["Neighbourhood Name"].astype(str)
    age_header_pos = label_col[label_col == AGE_HEADER_ROW].index[0]
    block_header_positions = [
        (label_col[label_col == header].index[0], offsets) for header, offsets in HEADER_ANCHORED_BLOCKS
    ]

    wide = raw.set_index("Neighbourhood Name")
    # Column headers are neighbourhood *names*; the "Neighbourhood Number" row
    # gives each column's numeric code, which is what AREA_SHORT_CODE in the
    # boundary layer also uses (zero-padded there).
    codes_row = wide.loc["Neighbourhood Number"]

    records = []
    for col_name, code in codes_row.items():
        code_str = f"{int(code):03d}"
        record = {"AREA_SHORT_CODE": code_str, "neighbourhood_name": col_name}
        for out_col, offset in AGE_ROW_OFFSETS.items():
            value = raw.at[age_header_pos + offset, col_name]
            record[out_col] = pd.to_numeric(value, errors="coerce")
        for out_col, row_label in ALL_LABEL_ROWS.items():
            value = wide.loc[row_label, col_name] if row_label in wide.index else None
            record[out_col] = pd.to_numeric(value, errors="coerce")
        for header_pos, offsets in block_header_positions:
            for out_col, offset in offsets.items():
                value = raw.at[header_pos + offset, col_name]
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
                "granularity; city-wide (all 158), see module docstring in "
                "data/ingest_census.py."
            ),
        },
    )
    print(f"[census_profile] {len(profile)} neighbourhoods, written to {out_path}")
    return profile


def main() -> None:
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    _ingest_neighbourhood_boundaries()
    _ingest_census_profile()


if __name__ == "__main__":
    main()
