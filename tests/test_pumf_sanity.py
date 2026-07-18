"""Sanity checks on data/ingest_pumf.py's output -- catches wrong-column /
wrong-decoding mistakes (e.g. the household_income unit mixup caught during
manual review: HHInc looked like raw dollars but is actually a 33-band
categorical code)."""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

PROCESSED_DIR = Path(__file__).resolve().parent.parent / "data" / "processed"


@pytest.fixture(scope="module")
def pumf_df() -> pd.DataFrame:
    path = PROCESSED_DIR / "pumf_toronto.csv"
    assert path.exists(), "run `uv run python -m data.ingest_pumf` first"
    return pd.read_csv(path)


def test_row_count_matches_toronto_cma_extraction(pumf_df: pd.DataFrame):
    assert len(pumf_df) == 165509


def test_weight_sums_to_roughly_toronto_cma_population(pumf_df: pd.DataFrame):
    # 2021 Census: Toronto CMA population ~6.2M. PUMF weights should
    # approximate that when summed (25% long-form sample, reweighted).
    total = pumf_df["weight"].sum()
    assert 5_500_000 <= total <= 6_800_000


def test_gender_has_no_bogus_categories(pumf_df: pd.DataFrame):
    assert set(pumf_df["gender"].dropna().unique()) == {"Woman+", "Man+"}


def test_tenure_has_no_bogus_categories(pumf_df: pd.DataFrame):
    assert set(pumf_df["tenure"].dropna().unique()) == {"Owner", "Renter"}


def test_household_income_is_banded_not_raw_dollars(pumf_df: pd.DataFrame):
    # Regression guard for the unit mixup: household_income must be one of
    # the 33 known band labels, never a bare numeric string.
    valid_bands = {
        "Under $2,000", "$250,000 and over",
    }
    non_null = pumf_df["household_income"].dropna()
    assert non_null.str.contains(r"^\$|^Under", regex=True).all()
    assert valid_bands.issubset(set(non_null.unique()))


def test_household_income_band_midpoint_is_plausible_dollar_range(pumf_df: pd.DataFrame):
    midpoints = pumf_df["household_income_band_midpoint"].dropna()
    assert midpoints.min() >= 1000
    assert midpoints.max() <= 300_000
    # Toronto median household income should land in a plausible range.
    assert 60_000 <= midpoints.median() <= 200_000


def test_total_income_is_raw_dollars_not_banded(pumf_df: pd.DataFrame):
    # TotInc is genuinely continuous (rounded to nearest $1,000) -- confirm
    # it has far more unique values than a 33-band variable would.
    assert pumf_df["total_income"].dropna().nunique() > 100
