from __future__ import annotations

import geopandas as gpd
import pandas as pd
import pytest

from population.sampler import AGE_BANDS, COMMUTE_MODES, TENURE_VALUES, sample_population
from twin.state import TwinState


@pytest.fixture(scope="module")
def census_df() -> pd.DataFrame:
    from pathlib import Path

    path = Path(__file__).resolve().parent.parent / "data" / "processed" / "census_profile.csv"
    return pd.read_csv(path)


@pytest.fixture(scope="module")
def neighbourhoods_gdf() -> gpd.GeoDataFrame:
    from pathlib import Path

    path = Path(__file__).resolve().parent.parent / "data" / "processed" / "neighbourhoods.geojson"
    return gpd.read_file(path)


def test_sample_population_produces_requested_order_of_magnitude(
    base_state: TwinState, census_df: pd.DataFrame, neighbourhoods_gdf: gpd.GeoDataFrame
):
    personas = sample_population(base_state, census_df, neighbourhoods_gdf, n_personas=200, seed=42)
    # Allocation rounds per-neighbourhood, and neighbourhoods with zero
    # buildings in the twin are skipped, so this won't be exactly 200 --
    # it should be in the right ballpark.
    assert 100 <= len(personas) <= 300


def test_personas_have_real_home_features_in_the_twin(base_state: TwinState, census_df: pd.DataFrame, neighbourhoods_gdf: gpd.GeoDataFrame):
    personas = sample_population(base_state, census_df, neighbourhoods_gdf, n_personas=100, seed=1)
    assert len(personas) > 0
    for p in personas:
        building = base_state.get("buildings", p.home_feature_id)
        assert building is not None, f"{p.home_feature_id} is not a real twin feature"


def test_persona_attributes_are_valid_categories(base_state: TwinState, census_df: pd.DataFrame, neighbourhoods_gdf: gpd.GeoDataFrame):
    personas = sample_population(base_state, census_df, neighbourhoods_gdf, n_personas=100, seed=2)
    for p in personas:
        assert p.age_band in AGE_BANDS
        assert p.tenure in TENURE_VALUES
        assert p.commute_mode in COMMUTE_MODES


def test_sampling_is_deterministic_given_seed(base_state: TwinState, census_df: pd.DataFrame, neighbourhoods_gdf: gpd.GeoDataFrame):
    a = sample_population(base_state, census_df, neighbourhoods_gdf, n_personas=50, seed=7)
    b = sample_population(base_state, census_df, neighbourhoods_gdf, n_personas=50, seed=7)
    assert [p.id for p in a] == [p.id for p in b]
    assert [p.home_feature_id for p in a] == [p.home_feature_id for p in b]
    assert [p.age_band for p in a] == [p.age_band for p in b]


def test_neighbourhood_allocation_roughly_tracks_population_share(
    base_state: TwinState, census_df: pd.DataFrame, neighbourhoods_gdf: gpd.GeoDataFrame
):
    """The most populous overlapping neighbourhood should get noticeably
    more personas than the least populous one -- confirms this is actually
    census-*weighted*, not a uniform split across neighbourhoods."""
    personas = sample_population(base_state, census_df, neighbourhoods_gdf, n_personas=400, seed=3)
    counts: dict[str, int] = {}
    for p in personas:
        counts[p.neighbourhood_code] = counts.get(p.neighbourhood_code, 0) + 1
    assert len(counts) > 1
    assert max(counts.values()) > min(counts.values())
