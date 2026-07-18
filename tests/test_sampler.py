from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

from population.sampler import AGE_BANDS, TENURE_VALUES, sample_population

PROCESSED_DIR = Path(__file__).resolve().parent.parent / "data" / "processed"


@pytest.fixture(scope="module")
def census_df() -> pd.DataFrame:
    return pd.read_csv(PROCESSED_DIR / "census_profile.csv")


@pytest.fixture(scope="module")
def pumf_df() -> pd.DataFrame:
    return pd.read_csv(PROCESSED_DIR / "pumf_toronto.csv")


def test_sample_population_produces_requested_order_of_magnitude(census_df: pd.DataFrame, pumf_df: pd.DataFrame):
    personas = sample_population(census_df, pumf_df, n_personas=500, seed=42)
    # Allocation rounds per-neighbourhood, so this won't be exactly 500 --
    # should be in the right ballpark, and every neighbourhood gets at
    # least 1 (all 158 have nonzero population).
    assert 400 <= len(personas) <= 700


def test_all_158_neighbourhoods_get_personas(census_df: pd.DataFrame, pumf_df: pd.DataFrame):
    personas = sample_population(census_df, pumf_df, n_personas=1000, seed=1)
    codes = {p.neighbourhood_code for p in personas}
    assert len(codes) == 158


def test_persona_attributes_are_valid_categories(census_df: pd.DataFrame, pumf_df: pd.DataFrame):
    personas = sample_population(census_df, pumf_df, n_personas=200, seed=2)
    for p in personas:
        assert p.age_band in AGE_BANDS
        assert p.tenure in TENURE_VALUES
        assert 1 <= p.household_income_decile <= 10


def test_sampling_is_deterministic_given_seed(census_df: pd.DataFrame, pumf_df: pd.DataFrame):
    a = sample_population(census_df, pumf_df, n_personas=100, seed=7)
    b = sample_population(census_df, pumf_df, n_personas=100, seed=7)
    assert [p.id for p in a] == [p.id for p in b]
    assert [p.age_band for p in a] == [p.age_band for p in b]
    assert [p.total_income for p in a] == [p.total_income for p in b]


def test_neighbourhood_allocation_roughly_tracks_population_share(census_df: pd.DataFrame, pumf_df: pd.DataFrame):
    """The most populous neighbourhood should get noticeably more personas
    than the least populous one -- confirms this is census-*weighted*, not
    a uniform split across neighbourhoods."""
    personas = sample_population(census_df, pumf_df, n_personas=2000, seed=3)
    counts: dict[str, int] = {}
    for p in personas:
        counts[p.neighbourhood_code] = counts.get(p.neighbourhood_code, 0) + 1
    assert len(counts) > 1
    assert max(counts.values()) > min(counts.values()) * 2


def test_personas_carry_real_joint_attributes_not_just_controls(census_df: pd.DataFrame, pumf_df: pd.DataFrame):
    """At least the raking-controlled attributes must vary meaningfully in
    the output, and non-controlled attributes (education, visible minority)
    should also show real variation -- confirming full PUMF rows ride along
    with each draw rather than only the 3 control fields being populated."""
    personas = sample_population(census_df, pumf_df, n_personas=2000, seed=4)
    educations = {p.education for p in personas if p.education is not None}
    vismins = {p.visible_minority for p in personas if p.visible_minority is not None}
    assert len(educations) > 3
    assert len(vismins) > 3
