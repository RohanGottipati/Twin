"""Sanity checks on data/ingest_ces.py's output."""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

PROCESSED_DIR = Path(__file__).resolve().parent.parent / "data" / "processed"


@pytest.fixture(scope="module")
def ces_df() -> pd.DataFrame:
    path = PROCESSED_DIR / "ces_ontario.csv"
    assert path.exists(), "run `uv run python -m data.ingest_ces` first"
    return pd.read_csv(path)


def test_row_count_matches_ontario_extraction(ces_df: pd.DataFrame):
    assert len(ces_df) == 7309


def test_ideology_scale_is_bounded_0_to_10(ces_df: pd.DataFrame):
    scale = ces_df["ideology_lr_scale"].dropna()
    assert scale.min() >= 0
    assert scale.max() <= 10


def test_income_has_no_implausible_outliers(ces_df: pd.DataFrame):
    income = ces_df["income"].dropna()
    assert income.min() >= 0
    assert income.max() <= 2_000_000


def test_conservative_voters_place_further_right_than_ndp():
    # Real-world sanity check: on CES's 0 (left) to 10 (right) scale,
    # Conservative identifiers should average well to the right of NDP
    # identifiers. This would catch a mixed-up scale direction or a bad
    # variable substitution.
    df = pd.read_csv(PROCESSED_DIR / "ces_ontario.csv")
    means = df.groupby("party_id")["ideology_lr_scale"].mean()
    assert means["Conservative Party"] > means["NDP"] + 2
