"""Natural-language persona rendering, shared by every persona source.

Design decision (coordinator + user, 2026-07-18, not an AGENTS.md section 9
open question -- an implementation choice within the already-licensed 4.3/5.1
persona work): personas are shown to the model as a short natural-language
paragraph, not a fixed structured JSON blob. Two reasons:

1. A rigid schema baked into SFT rows teaches "opinion depends on exactly
   these N keys in this shape" -- brittle the moment a new attribute
   (e.g. a spatial feature, a new demographic axis) is added later, and is
   itself an overfitting surface distinct from the population-level
   mode-collapse problem Phase 2 already found.
2. It matches the project's existing legible-text ethic (AGENTS.md 3.3) on
   the input side, not just the scored output side.

`persona_to_text()` is the single owner of this rendering for every source:
real census personas (`population/sampler.py`) at inference time, ANES-
derived SFT personas, Toronto-consultation-derived personas, and Polis's
fully-synthetic ones (`generate_synthetic_attributes()` below). Do not let
each ingester grow its own ad hoc verbalization prompt.

**Provenance is tracked separately from rendering.** Whether a persona's
attributes are real (drawn from ANES/census) or fully fabricated (Polis,
where no demographic data exists at all), that distinction lives in the
caller's row `metadata["persona_provenance"]`, never in the text itself --
the rendered paragraph looks the same either way. This module only turns
attributes into prose; it has no opinion about where those attributes came
from and must not be trusted as the source of truth on that question.
"""

from __future__ import annotations

import random

from model.serving import complete_chat

_VERBALIZE_SYSTEM_PROMPT = (
    "You turn a short list of demographic/situational attributes into a "
    "brief, natural first-person-adjacent persona description (2-4 "
    "sentences), as if introducing this person before they give an opinion. "
    "Plain, neutral prose. Do not invent attributes beyond what is given. "
    "Do not mention that this is a persona, a profile, or an AI-generated "
    "description -- just write the description itself, nothing else."
)

# A generic attribute pool for fully-synthetic personas (Polis rows, where
# no real demographic data exists for anonymous participants). Deliberately
# not calibrated against any real distribution -- flagged at the call site
# via persona_provenance, never presented as census-weighted.
_SYNTHETIC_AGE_BANDS = ["18-24", "25-34", "35-44", "45-54", "55-64", "65+"]
_SYNTHETIC_TENURE = ["owner", "renter"]
_SYNTHETIC_COMMUTE = ["car", "transit", "walk", "bicycle", "other", "work from home"]
_SYNTHETIC_INCOME_BANDS = ["under $30k", "$30k-$60k", "$60k-$100k", "$100k-$150k", "over $150k"]
_SYNTHETIC_EDUCATION = ["high school", "some college", "bachelor's degree", "graduate degree"]
_SYNTHETIC_HOUSEHOLD = ["lives alone", "lives with a partner", "lives with roommates", "lives with family, incl. children"]


def generate_synthetic_attributes(rng: random.Random) -> dict[str, str]:
    """Generate a fully-fabricated attribute dict for a Polis-derived SFT
    row, where no real demographic data exists to attach (participants are
    anonymous). Explicitly not sampled from any real distribution -- callers
    must tag persona_provenance="synthetic" and must never treat this as
    calibration-grade data. Scope: hackathon-grade format-teaching filler
    only, per the user's explicit call."""
    return {
        "age_band": rng.choice(_SYNTHETIC_AGE_BANDS),
        "tenure": rng.choice(_SYNTHETIC_TENURE),
        "commute_mode": rng.choice(_SYNTHETIC_COMMUTE),
        "income_band": rng.choice(_SYNTHETIC_INCOME_BANDS),
        "education": rng.choice(_SYNTHETIC_EDUCATION),
        "household": rng.choice(_SYNTHETIC_HOUSEHOLD),
    }


def attribute_dropout(attributes: dict[str, str], rng: random.Random, keep_prob: float = 0.7, min_keep: int = 1) -> dict[str, str]:
    """Randomly subset which attributes get rendered into text this time,
    so training sees personas described at varying levels of completeness
    and the model doesn't learn to expect every field on every input. The
    full attribute dict (caller's copy) is untouched -- this only affects
    what gets passed to persona_to_text for one particular row."""
    keys = list(attributes.keys())
    kept = [k for k in keys if rng.random() < keep_prob]
    if len(kept) < min_keep:
        kept = rng.sample(keys, k=min(min_keep, len(keys)))
    return {k: attributes[k] for k in kept}


def persona_to_text(attributes: dict[str, str], *, temperature: float = 0.7, max_tokens: int = 120) -> str:
    """Render an attribute dict as a short natural-language persona
    description via the configured LM backend (local vLLM by default, see
    model/serving.py). Raises NoLLMBackendAvailable if unreachable --
    callers must not fall back to a hand-templated string, since that would
    silently reintroduce the fixed-shape problem this module exists to
    avoid."""
    attr_lines = "\n".join(f"- {key.replace('_', ' ')}: {value}" for key, value in attributes.items())
    messages = [
        {"role": "system", "content": _VERBALIZE_SYSTEM_PROMPT},
        {"role": "user", "content": f"Attributes:\n{attr_lines}"},
    ]
    return complete_chat(messages, temperature=temperature, max_tokens=max_tokens).strip()
