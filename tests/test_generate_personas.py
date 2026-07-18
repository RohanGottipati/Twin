from __future__ import annotations

import pandas as pd
import pytest

from population.generate_personas import ADULT_AGE_BANDS, sample_adult_personas


@pytest.fixture(scope="module")
def census_df() -> pd.DataFrame:
    return pd.read_csv("data/processed/census_profile.csv")


@pytest.fixture(scope="module")
def pumf_df() -> pd.DataFrame:
    return pd.read_csv("data/processed/pumf_toronto.csv")


def test_sample_adult_personas_excludes_children(census_df: pd.DataFrame, pumf_df: pd.DataFrame):
    personas = sample_adult_personas(census_df, pumf_df, n_personas=1000, seed=1)
    assert len(personas) > 0
    assert all(p.age_band in ADULT_AGE_BANDS for p in personas)
    assert all(p.age_band != "0-14" for p in personas)
