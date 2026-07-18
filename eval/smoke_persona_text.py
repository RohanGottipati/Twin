"""Manual smoke test for population/persona_text.py -- not a pytest gate,
just a quick real-model check that (1) real structured attributes render as
legible prose, (2) dropout produces visibly varying descriptions from the
same underlying persona, and (3) fully-synthetic (Polis) attributes render
the same way with no special-casing. Run with:

    uv run python -m eval.smoke_persona_text
"""

from __future__ import annotations

import random

from population.persona_text import (
    attribute_dropout,
    generate_synthetic_attributes,
    persona_to_text,
)

REAL_ANES_LIKE_PERSONA = {
    "age_band": "35-44",
    "education": "bachelor's degree",
    "race": "Black",
    "sex": "female",
    "party_id": "Democrat",
    "ideology": "liberal",
    "income_band": "$60k-$100k",
}


def main() -> None:
    rng = random.Random(0)

    print("=== 1. Full real attribute set ===")
    print(persona_to_text(REAL_ANES_LIKE_PERSONA))
    print()

    print("=== 2. Same persona, three dropout renderings (variance check) ===")
    for i in range(3):
        subset = attribute_dropout(REAL_ANES_LIKE_PERSONA, rng, keep_prob=0.6)
        print(f"-- kept fields: {sorted(subset.keys())}")
        print(persona_to_text(subset))
        print()

    print("=== 3. Fully-synthetic (Polis-style) attribute set ===")
    synthetic = generate_synthetic_attributes(rng)
    print(f"-- generated attributes: {synthetic}")
    print(persona_to_text(synthetic))
    print()

    print("=== 4. Synthetic persona with dropout applied too ===")
    synthetic2 = generate_synthetic_attributes(rng)
    subset2 = attribute_dropout(synthetic2, rng, keep_prob=0.5)
    print(f"-- full: {synthetic2}")
    print(f"-- kept: {sorted(subset2.keys())}")
    print(persona_to_text(subset2))


if __name__ == "__main__":
    main()
