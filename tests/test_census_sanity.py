"""Sanity checks on data/ingest_census.py's output. These would have caught
the original row-offset bug (age sub-groups summing to roughly 1/4 of the
real population total because of an off-by-N row offset) -- run offline
against the committed data/processed/ files."""

from __future__ import annotations

from pathlib import Path

import geopandas as gpd
import pandas as pd
import pytest

PROCESSED_DIR = Path(__file__).resolve().parent.parent / "data" / "processed"


@pytest.fixture(scope="module")
def census_df() -> pd.DataFrame:
    path = PROCESSED_DIR / "census_profile.csv"
    assert path.exists(), "run `uv run python -m data.ingest_census` first"
    return pd.read_csv(path)


def test_fourteen_neighbourhoods_overlap_ward_13(census_df: pd.DataFrame):
    # Documented in data/ingest_census.py: Ward 13 "Toronto Centre" + 300m
    # buffer overlaps exactly 14 of the city's 158 neighbourhoods.
    assert len(census_df) == 14


def test_age_subgroups_sum_to_population_total(census_df: pd.DataFrame):
    age_sum = census_df["age_0_14"] + census_df["age_15_64"] + census_df["age_65_plus"]
    # Allow small rounding slack (StatCan random-rounds small counts to a
    # multiple of 5 for disclosure control).
    assert (age_sum - census_df["pop_total"]).abs().max() <= 10


def test_tenure_subgroups_sum_close_to_tenure_total(census_df: pd.DataFrame):
    tenure_sum = census_df["tenure_owner"] + census_df["tenure_renter"]
    assert (tenure_sum <= census_df["tenure_total"] * 1.01).all()
    assert (tenure_sum >= census_df["tenure_total"] * 0.90).all()


def test_commute_subgroups_do_not_exceed_total(census_df: pd.DataFrame):
    commute_sum = (
        census_df["commute_car"]
        + census_df["commute_transit"]
        + census_df["commute_walk"]
        + census_df["commute_bicycle"]
        + census_df["commute_other"]
    )
    assert (commute_sum <= census_df["commute_total"] * 1.01).all()


def test_no_negative_or_null_core_counts(census_df: pd.DataFrame):
    core_cols = ["pop_total", "age_0_14", "age_15_64", "age_65_plus", "tenure_owner", "tenure_renter"]
    for col in core_cols:
        assert census_df[col].notna().all(), f"{col} has nulls"
        assert (census_df[col] >= 0).all(), f"{col} has negatives"


def test_neighbourhoods_geojson_matches_census_profile_codes(census_df: pd.DataFrame):
    nb = gpd.read_file(PROCESSED_DIR / "neighbourhoods.geojson")
    assert nb.crs.to_epsg() == 26917
    codes_geo = set(nb["AREA_SHORT_CODE"].astype(str).str.zfill(3))
    codes_census = set(census_df["AREA_SHORT_CODE"].astype(str).str.zfill(3))
    assert codes_geo == codes_census
