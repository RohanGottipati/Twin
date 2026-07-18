"""Census-weighted persona sampling (implementation_plan.md Phase 1).

Each `Persona` is wired to the twin via a real `home_feature_id` (a building
in `twin/state.py`'s `buildings` layer), so later phases can compute spatial
features (distance to a change, commute delta) directly against the same
twin the invariants operate on.

**Granularity, flagged explicitly (see data/ingest_census.py for the full
rationale):** personas are sampled per neighbourhood (14 neighbourhoods
overlapping Ward 13), not per StatCan dissemination area as
implementation_plan.md's Phase 1 text names, because true DA-level census
*attributes* were not reachable without guessing at a form-driven download.
Within each neighbourhood, individual personas are drawn by sampling each
attribute (age band, tenure, commute mode) *independently* from that
neighbourhood's real marginal frequency counts -- there is no attempt to
model correlation between age/tenure/commute (e.g. "young renters commute by
transit more than older owners" is a real pattern this sampler cannot
produce, because we only have marginal counts, not the joint distribution).

This independent-marginal sampling is a deliberate, simplest-possible choice
for the Phase 1 "start coarse" gate -- it is NOT an answer to AGENTS.md
section 9 open question 3 ("one persona per census cell, or sampled
individuals?"). That question is about the system's eventual validated
design (whether persona generation should model joint within-cell
correlation, use real microdata, etc.) and still needs human sign-off before
Phase 2+ calibration work leans on a specific answer. Tonight's sampler
produces *sampled individuals*, weighted so the population's aggregate
composition matches each neighbourhood's real census marginals, purely to
stand up the Phase 1 loop end-to-end; it should not be read as a resolved
design decision.

Household income has no per-person distribution in the source data (only a
neighbourhood median), so it is attached as a shared per-neighbourhood
covariate (`neighbourhood_median_income`) rather than a fabricated
per-persona draw.
"""

from __future__ import annotations

import random
from dataclasses import dataclass

import geopandas as gpd
import pandas as pd

from twin.state import TwinState

AGE_BANDS = ["0-14", "15-64", "65+"]
TENURE_VALUES = ["owner", "renter"]
COMMUTE_MODES = ["car", "transit", "walk", "bicycle", "other"]


@dataclass(frozen=True)
class Persona:
    id: str
    neighbourhood_code: str
    neighbourhood_name: str
    home_feature_id: str
    home_x: float
    home_y: float
    age_band: str
    tenure: str
    commute_mode: str
    neighbourhood_median_income: float | None


def _weighted_choice(rng: random.Random, values: list[str], weights: list[float]) -> str:
    total = sum(weights)
    if total <= 0:
        return rng.choice(values)
    return rng.choices(values, weights=weights, k=1)[0]


def _buildings_by_neighbourhood(state: TwinState, neighbourhoods: gpd.GeoDataFrame) -> dict[str, list[tuple[str, float, float]]]:
    """Spatial-join every building centroid to the neighbourhood polygon it
    falls in. Returns {AREA_SHORT_CODE: [(feature_id, x, y), ...]}."""
    buildings = state.all_features("buildings")
    if not buildings:
        return {}
    ids = [f.id for f in buildings]
    centroids = []
    for f in buildings:
        from shapely.geometry import shape

        centroids.append(shape(f.geometry.model_dump()).centroid)
    b_gdf = gpd.GeoDataFrame({"feature_id": ids}, geometry=centroids, crs=neighbourhoods.crs)
    joined = gpd.sjoin(b_gdf, neighbourhoods[["AREA_SHORT_CODE", "geometry"]], how="inner", predicate="within")

    result: dict[str, list[tuple[str, float, float]]] = {}
    for _, row in joined.iterrows():
        code = str(row["AREA_SHORT_CODE"]).zfill(3)
        result.setdefault(code, []).append((row["feature_id"], row.geometry.x, row.geometry.y))
    return result


def sample_population(
    state: TwinState,
    census: pd.DataFrame,
    neighbourhoods: gpd.GeoDataFrame,
    n_personas: int,
    seed: int = 0,
) -> list[Persona]:
    """Draw `n_personas` total, allocated across neighbourhoods proportional
    to real 2021 population counts (`pop_total`), each with age/tenure/
    commute-mode sampled independently from that neighbourhood's real
    marginal frequencies, and a home node sampled uniformly from that
    neighbourhood's buildings in the twin.

    Neighbourhoods with zero buildings in the (Ward-13-clipped) twin are
    skipped with no personas -- there is nowhere to place a home node for
    them. This is logged via the returned personas' coverage, not silently:
    callers should compare `{p.neighbourhood_code for p in result}` against
    `census["AREA_SHORT_CODE"]` to see what was dropped.
    """
    rng = random.Random(seed)
    census = census.set_index(census["AREA_SHORT_CODE"].astype(str).str.zfill(3))
    buildings_by_nb = _buildings_by_neighbourhood(state, neighbourhoods)

    total_pop = census["pop_total"].sum()
    personas: list[Persona] = []
    counter = 0

    for code, row in census.iterrows():
        homes = buildings_by_nb.get(code, [])
        if not homes:
            continue
        share = row["pop_total"] / total_pop
        n_for_nb = max(1, round(n_personas * share)) if share > 0 else 0

        age_weights = [row["age_0_14"], row["age_15_64"], row["age_65_plus"]]
        tenure_weights = [row["tenure_owner"], row["tenure_renter"]]
        commute_weights = [
            row["commute_car"],
            row["commute_transit"],
            row["commute_walk"],
            row["commute_bicycle"],
            row["commute_other"],
        ]
        median_income = row["median_total_income"] if pd.notna(row["median_total_income"]) else None

        for _ in range(n_for_nb):
            feature_id, x, y = rng.choice(homes)
            persona = Persona(
                id=f"persona:{counter}",
                neighbourhood_code=code,
                neighbourhood_name=row["neighbourhood_name"],
                home_feature_id=feature_id,
                home_x=x,
                home_y=y,
                age_band=_weighted_choice(rng, AGE_BANDS, age_weights),
                tenure=_weighted_choice(rng, TENURE_VALUES, tenure_weights),
                commute_mode=_weighted_choice(rng, COMMUTE_MODES, commute_weights),
                neighbourhood_median_income=median_income,
            )
            personas.append(persona)
            counter += 1

    return personas
