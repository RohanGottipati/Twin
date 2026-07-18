"""Generate persona text for opinion tasks: adults only.

Children (age_band '0-14') are excluded -- nobody is going to ask a 0-14
year old for their opinion on a transit stop or a zoning change, so
filtering them out here (rather than teaching the verbalizer a child voice)
is the right place to draw the line for this use case. The underlying
neighbourhood population composition sampled by population.sampler still
reflects real children's share correctly; this filter only narrows which
personas get used for *opinion generation*, not the census accuracy of
sample_population itself.
"""

from __future__ import annotations

import random

import pandas as pd

from population.persona_text import render_persona_from_sampler
from population.sampler import Persona, sample_population

ADULT_AGE_BANDS = ("15-64", "65+")


def sample_adult_personas(
    census: pd.DataFrame,
    pumf: pd.DataFrame,
    n_personas: int,
    seed: int = 0,
) -> list[Persona]:
    personas = sample_population(census, pumf, n_personas=n_personas, seed=seed)
    return [p for p in personas if p.age_band in ADULT_AGE_BANDS]


def generate_opinion_persona_batch(
    census: pd.DataFrame,
    pumf: pd.DataFrame,
    n_draw_pool: int,
    n_show: int,
    seed: int = 0,
) -> list[dict]:
    """Draw a pool of `n_draw_pool` adult personas, then verbalize a random
    `n_show` of them (spread across distinct neighbourhoods where
    possible) -- verbalization is the LLM-call bottleneck, so the draw pool
    can be much larger than what's actually rendered to text."""
    rng = random.Random(seed)
    personas = sample_adult_personas(census, pumf, n_personas=n_draw_pool, seed=seed)

    by_nb: dict[str, list[Persona]] = {}
    for p in personas:
        by_nb.setdefault(p.neighbourhood_code, []).append(p)
    codes = rng.sample(list(by_nb.keys()), min(n_show, len(by_nb)))
    sample = [rng.choice(by_nb[c]) for c in codes]

    results = []
    for p in sample:
        text, kept = render_persona_from_sampler(p, rng)
        results.append(
            {
                "persona_id": p.id,
                "neighbourhood_code": p.neighbourhood_code,
                "neighbourhood_name": p.neighbourhood_name,
                "age_band": p.age_band,
                "kept_attributes": kept,
                "text": text,
            }
        )
    return results


if __name__ == "__main__":
    census_df = pd.read_csv("data/processed/census_profile.csv")
    pumf_df = pd.read_csv("data/processed/pumf_toronto.csv")
    batch = generate_opinion_persona_batch(census_df, pumf_df, n_draw_pool=5000, n_show=20, seed=2026)
    for i, entry in enumerate(batch, 1):
        print(f"--- {i}. {entry['neighbourhood_name']} ({entry['neighbourhood_code']}), age {entry['age_band']} ---")
        print("kept attrs:", entry["kept_attributes"])
        print(entry["text"])
        print()
