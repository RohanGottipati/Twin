"""City-wide, joint-correlated persona sampling (2026-07-18 rewrite).

Supersedes the earlier independent-marginal sampler (see git history) per
explicit user direction: personas must be *representative of the type of
people who actually live there*, not just independently-sampled attribute
bins that can produce impossible combinations (e.g. "young high-income
retiree"). Also explicitly descoped from building/home-location geometry --
"this is not about visualization its about simulation" -- so this sampler
no longer joins to the twin's buildings layer at all.

Design: iterative proportional fitting (raking; `population/ipf_fit.py`)
reweights the real 165,509-individual StatCan 2021 Census PUMF Toronto-CMA
seed against each of the 158 neighbourhoods' real marginal control totals
(age band, tenure, income decile -- the three dimensions with categories
that align cleanly between the PUMF and the City's neighbourhood census
profile). Sampling with the fitted weights (with replacement) then yields,
for each neighbourhood, synthetic residents whose controlled attributes
match that neighbourhood's real composition while every *other* PUMF
attribute (education, visible minority, immigration/generation status,
mother tongue, dwelling type, household type, exact income) rides along
from the real individual record -- preserving real joint correlation
instead of redrawing each attribute independently.

This is still not a resolved answer to AGENTS.md section 9 open question 3
("one persona per census cell, or sampled individuals?") -- it is sampled
individuals, reweighted to match real marginals via raking on 3 controls,
which is a documented, defensible design point but not sign-off on the
final answer.

`home_feature_id`/`home_x`/`home_y` are kept on `Persona` as optional
fields (always `None` from this sampler) purely for backward compatibility
with `eval/spatial_counterfactual.py`, which manually constructs `Persona`
instances with real twin building coordinates for the separate Phase 3
spatial-effect-graph gate -- an orthogonal concern to demographic realism.
"""

from __future__ import annotations

import random
from dataclasses import dataclass

import pandas as pd

from population.ipf_fit import fit_neighbourhood_weights, prepare_seed

AGE_BANDS = ["0-14", "15-64", "65+"]
TENURE_VALUES = ["Owner", "Renter"]


@dataclass(frozen=True)
class Persona:
    id: str
    neighbourhood_code: str
    neighbourhood_name: str
    age_band: str
    tenure: str
    # Everything below defaults to None so eval/spatial_counterfactual.py's
    # minimal, manually-constructed personas (for the separate Phase 3
    # spatial-effect-graph gate) keep working without specifying every PUMF
    # attribute this sampler now fills in.
    commute_mode: str | None = None
    gender: str | None = None
    education: str | None = None
    immigration_status: str | None = None
    generation_status: str | None = None
    visible_minority: str | None = None
    dwelling_type: str | None = None
    household_type: str | None = None
    family_status: str | None = None
    mother_tongue_english: bool | None = None
    mother_tongue_french: bool | None = None
    total_income: float | None = None
    household_income_band: str | None = None
    household_income_decile: int | None = None
    neighbourhood_median_income: float | None = None
    # Kept for backward compatibility with eval/spatial_counterfactual.py's
    # manually-constructed personas (real twin building coordinates); this
    # sampler never populates them -- see module docstring.
    home_feature_id: str | None = None
    home_x: float | None = None
    home_y: float | None = None


def sample_population(
    census: pd.DataFrame,
    pumf: pd.DataFrame,
    n_personas: int,
    seed: int = 0,
) -> list[Persona]:
    """Draw `n_personas` total, allocated across all 158 neighbourhoods
    proportional to real 2021 population counts (`pop_total`). For each
    neighbourhood, raking-fits the PUMF seed's weights against that
    neighbourhood's real age/tenure/income-decile marginals, then draws
    individuals with replacement using the fitted weights -- so every
    persona's full attribute set (not just the 3 raking controls) is a real
    PUMF individual's real joint profile, reweighted to fit the
    neighbourhood rather than independently resampled per attribute.
    """
    rng = random.Random(seed)
    seed_df = prepare_seed(pumf)
    census = census.set_index(census["AREA_SHORT_CODE"].astype(str).str.zfill(3))

    total_pop = census["pop_total"].sum()
    personas: list[Persona] = []
    counter = 0

    for code, row in census.iterrows():
        share = row["pop_total"] / total_pop if total_pop > 0 else 0
        n_for_nb = max(1, round(n_personas * share)) if share > 0 else 0
        if n_for_nb == 0:
            continue

        fitted_weights = fit_neighbourhood_weights(seed_df, row)
        if fitted_weights.sum() <= 0:
            continue

        drawn_indices = rng.choices(
            range(len(seed_df)),
            weights=fitted_weights.tolist(),
            k=n_for_nb,
        )
        median_income = row["median_total_income"] if pd.notna(row["median_total_income"]) else None

        for idx in drawn_indices:
            individual = seed_df.iloc[idx]
            persona = Persona(
                id=f"persona:{counter}",
                neighbourhood_code=code,
                neighbourhood_name=row["neighbourhood_name"],
                age_band=individual["age_band"],
                tenure=individual["tenure"],
                commute_mode=_none_if_nan(individual.get("commute_mode")),
                gender=_none_if_nan(individual.get("gender")),
                education=_none_if_nan(individual.get("education")),
                immigration_status=_none_if_nan(individual.get("immigration_status")),
                generation_status=_none_if_nan(individual.get("generation_status")),
                visible_minority=_none_if_nan(individual.get("visible_minority")),
                dwelling_type=_none_if_nan(individual.get("dwelling_type")),
                household_type=_none_if_nan(individual.get("household_type")),
                family_status=_none_if_nan(individual.get("family_status")),
                mother_tongue_english=_bool_or_none(individual.get("mother_tongue_english")),
                mother_tongue_french=_bool_or_none(individual.get("mother_tongue_french")),
                total_income=_none_if_nan(individual.get("total_income")),
                household_income_band=_none_if_nan(individual.get("household_income")),
                household_income_decile=int(individual["household_income_decile"]),
                neighbourhood_median_income=median_income,
            )
            personas.append(persona)
            counter += 1

    return personas


def _none_if_nan(value):
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    return value


def _bool_or_none(value: str | None) -> bool | None:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    return str(value).strip().lower().startswith("true")
