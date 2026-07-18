from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from population.ipf_fit import fit_neighbourhood_weights, neighbourhood_targets, prepare_seed, rake

PROCESSED_DIR = Path(__file__).resolve().parent.parent / "data" / "processed"


@pytest.fixture(scope="module")
def seed_df() -> pd.DataFrame:
    pumf = pd.read_csv(PROCESSED_DIR / "pumf_toronto.csv")
    return prepare_seed(pumf)


@pytest.fixture(scope="module")
def census_df() -> pd.DataFrame:
    return pd.read_csv(PROCESSED_DIR / "census_profile.csv")


def test_prepare_seed_collapses_to_three_age_bands(seed_df: pd.DataFrame):
    assert set(seed_df["age_band"].unique()) == {"0-14", "15-64", "65+"}


def test_prepare_seed_drops_negligible_missing_rows(seed_df: pd.DataFrame):
    # ~140/165509 rows are missing a control variable; dropping them should
    # lose well under 1% of the seed.
    assert len(seed_df) > 165_000


def test_rake_converges_to_exact_targets_on_synthetic_data():
    rng = np.random.default_rng(0)
    n = 5000
    columns = {
        "a": rng.choice(["x", "y"], size=n),
        "b": rng.choice(["p", "q", "r"], size=n),
    }
    base_weights = np.ones(n)
    targets = {"a": {"x": 3000.0, "y": 2000.0}, "b": {"p": 1500.0, "q": 2000.0, "r": 1500.0}}
    fitted = rake(base_weights, columns, targets)
    for dim, target in targets.items():
        for cat, total in target.items():
            got = fitted[columns[dim] == cat].sum()
            assert got == pytest.approx(total, rel=1e-3)


def test_fitted_weights_sum_to_neighbourhood_population(seed_df: pd.DataFrame, census_df: pd.DataFrame):
    row = census_df.iloc[10]
    weights = fit_neighbourhood_weights(seed_df, row)
    assert weights.sum() == pytest.approx(row["pop_total"], rel=0.01)


def test_fitted_weights_match_all_three_marginals(seed_df: pd.DataFrame, census_df: pd.DataFrame):
    row = census_df.iloc[20]
    weights = fit_neighbourhood_weights(seed_df, row)
    targets = neighbourhood_targets(row)
    for dim, target in targets.items():
        cats = seed_df[dim].to_numpy()
        for cat, expected in target.items():
            if expected <= 0:
                continue
            got = weights[cats == cat].sum()
            assert got == pytest.approx(expected, rel=0.02)
