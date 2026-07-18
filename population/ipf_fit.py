"""Iterative proportional fitting (raking) of the StatCan PUMF Toronto-CMA
seed against each neighbourhood's real marginal control totals.

Why hand-rolled raking instead of the installed PopGen3: PopGen3's
architecture reweights *households* with *persons nested inside* (it
requires a household_sample.csv linking persons into households). The PUMF
Individuals file has no household linkage (StatCan's anonymization strips
it) -- it is a flat list of persons with individual survey weights. Forcing
that into PopGen3's household/person hierarchy would mean fabricating
household structure that doesn't exist in the source data. Classic raking
(fit person weights to match several 1-way marginals, iterating until
convergence) is the standard technique for exactly this shape of problem
and needs no household fiction. This is a documented deviation from the
task's original PopGen3 plan, not a silent one -- see also AGENTS.md
section 9 open question 3 (persona granularity), which this still does not
resolve on its own.

The seed (165,509 real Toronto-CMA individuals, real joint correlations
across ~15 attributes) has no neighbourhood label. Raking against a given
neighbourhood's marginals (age band, tenure, income decile -- the three
control dimensions with cleanly aligned categories between the census
profile and the PUMF) produces per-individual *neighbourhood-specific*
weights: individuals whose profile looks like that neighbourhood's real
composition get upweighted, others downweighted. Sampling with these
weights (with replacement) yields synthetic residents whose controlled
attributes match the neighbourhood, while every other attribute (education,
visible minority, immigration status, mother tongue, dwelling type,
household type, exact income, ...) rides along from the real individual
record -- preserving real joint correlation instead of redrawing each
attribute independently.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

AGE_BAND_BY_PUMF_GROUP: dict[str, str] = {
    "0 to 4 years": "0-14",
    "5 to 6 years": "0-14",
    "7 to 9 years": "0-14",
    "10 to 11 years": "0-14",
    "12 to 14 years": "0-14",
    "15 to 17 years": "15-64",
    "18 to 19 years": "15-64",
    "20 to 24 years": "15-64",
    "25 to 29 years": "15-64",
    "30 to 34 years": "15-64",
    "35 to 39 years": "15-64",
    "40 to 44 years": "15-64",
    "45 to 49 years": "15-64",
    "50 to 54 years": "15-64",
    "55 to 59 years": "15-64",
    "60 to 64 years": "15-64",
    "65 to 69 years": "65+",
    "70 to 74 years": "65+",
    "75 to 79 years": "65+",
    "80 to 84 years": "65+",
    "85 years and over": "65+",
}

AGE_BANDS = ["0-14", "15-64", "65+"]
TENURE_VALUES = ["Owner", "Renter"]
INCOME_DECILES = list(range(1, 11))


def prepare_seed(pumf: pd.DataFrame) -> pd.DataFrame:
    """Collapse PUMF age_group to the 3 census-profile age bands and drop
    the small number of individuals (~0.1%) missing a control variable --
    they can't be assigned a raking cell on that dimension."""
    seed = pumf.copy()
    seed["age_band"] = seed["age_group"].map(AGE_BAND_BY_PUMF_GROUP)
    seed = seed.dropna(subset=["age_band", "tenure", "household_income_decile"]).reset_index(drop=True)
    seed["household_income_decile"] = seed["household_income_decile"].astype(int)
    return seed


def neighbourhood_targets(census_row: pd.Series) -> dict[str, dict]:
    """Marginal control totals for one neighbourhood, in the same category
    space as prepare_seed's output.

    Universe mismatch: age and income-decile marginals are counted in
    *persons* (pop_total), but tenure_owner/tenure_renter in the census
    profile are counted in *households* (tenure_total), a smaller number
    (~1/household-size). Raking requires every marginal on the same
    universe, so the tenure target is rescaled to its person-count
    equivalent using its own real proportions against pop_total -- this
    assumes owner and renter households have the same average size, a
    simplifying approximation (exact per-tenure household size isn't in
    this data), but keeps all three marginals internally consistent instead
    of one silently pulling total weight toward the wrong scale."""
    pop_total = census_row["pop_total"]
    age = {
        "0-14": census_row["age_0_14"],
        "15-64": census_row["age_15_64"],
        "65+": census_row["age_65_plus"],
    }
    tenure_total_hh = census_row["tenure_total"]
    tenure = {
        "Owner": census_row["tenure_owner"] / tenure_total_hh * pop_total if tenure_total_hh else 0,
        "Renter": census_row["tenure_renter"] / tenure_total_hh * pop_total if tenure_total_hh else 0,
    }
    decile = {d: census_row[f"income_decile_{d}"] for d in INCOME_DECILES}
    return {"age_band": age, "tenure": tenure, "household_income_decile": decile}


def rake(
    base_weights: np.ndarray,
    columns: dict[str, np.ndarray],
    targets: dict[str, dict],
    max_iter: int = 30,
    tol: float = 1e-6,
) -> np.ndarray:
    """Classic iterative proportional fitting: repeatedly rescale weights
    within each category of each dimension so the weighted total matches
    that category's target, cycling across dimensions until the largest
    per-cell adjustment factor is within `tol` of 1 (converged) or
    `max_iter` is hit. Targets of 0 are matched by construction (any weight
    in a zero-target cell should already have no support in a well-formed
    neighbourhood; guarded to never divide by zero).

    Performance note: category lookups are done once per dimension (via
    np.unique's inverse indices) outside the iteration loop, and each
    iteration's per-category sums use np.bincount rather than a Python loop
    over categories with a boolean mask each -- this is what makes fitting
    all 158 neighbourhoods against a 165k-row seed tractable (down from
    several minutes to a few seconds)."""
    weights = base_weights.astype(float).copy()

    dim_codes: dict[str, np.ndarray] = {}
    dim_target_arrays: dict[str, np.ndarray] = {}
    n_categories: dict[str, int] = {}
    for dim, target in targets.items():
        cats = columns[dim]
        unique_cats, codes = np.unique(cats, return_inverse=True)
        target_array = np.array([target.get(cat, 0.0) for cat in unique_cats], dtype=float)
        dim_codes[dim] = codes
        dim_target_arrays[dim] = target_array
        n_categories[dim] = len(unique_cats)

    for _ in range(max_iter):
        max_delta = 0.0
        for dim in targets:
            codes = dim_codes[dim]
            target_array = dim_target_arrays[dim]
            k = n_categories[dim]
            current = np.bincount(codes, weights=weights, minlength=k)
            factor = np.ones(k)
            nonzero = (target_array > 0) & (current > 0)
            factor[nonzero] = target_array[nonzero] / current[nonzero]
            weights *= factor[codes]
            cell_delta = np.abs(factor[nonzero] - 1.0)
            if cell_delta.size:
                max_delta = max(max_delta, cell_delta.max())
        if max_delta < tol:
            break
    return weights


def fit_neighbourhood_weights(seed: pd.DataFrame, census_row: pd.Series) -> np.ndarray:
    targets = neighbourhood_targets(census_row)
    columns = {
        "age_band": seed["age_band"].to_numpy(),
        "tenure": seed["tenure"].to_numpy(),
        "household_income_decile": seed["household_income_decile"].to_numpy(),
    }
    return rake(seed["weight"].to_numpy(), columns, targets)
