"""Natural-language persona rendering, shared by every persona source.

Design decision (coordinator + user, 2026-07-18): personas are shown to the
model as a short natural-language paragraph, not a fixed structured blob.

Rendering contract (user, 2026-07-18):
  - Attribute BINS are the ground truth stored in metadata.
  - The LM samples a concrete realization inside each kept bin
    (age 35-44 -> "38", income band -> a specific dollar figure,
     broad ethnicity -> a plausible specific background, etc.).
  - Light personal color is allowed so the paragraph feels like a person,
    not a form; no proper names.
  - Which bins appear is Bernoulli dropout with per-key keep probs, so
    training sees varying profile shapes.

Provenance stays on the bins in metadata["demographics"] /
persona_attributes; the rendered text is a sampled realization of those bins.
"""

from __future__ import annotations

import random

from model.serving import complete_chat

_VERBALIZE_SYSTEM_PROMPT = (
    "Turn survey/census attribute BINS into a short first-person background "
    "(2-3 sentences, roughly 35-70 words).\n"
    "Rules:\n"
    "1. For each bin, sample a SPECIFIC concrete value inside it. Examples: "
    "age '35-44' -> pick an age like 38; income '$20,000-$22,499' -> ~$21,000; "
    "'Asian or Pacific Islander' -> a plausible specific background like "
    "Filipino or Korean; 'professional or doctoral degree' -> e.g. PhD in "
    "literature or a law degree. Stay inside the bin.\n"
    "2. Do not list attributes in a fixed checklist order; vary emphasis and "
    "order so it reads like a person talking about themselves.\n"
    "3. Add a little personal color consistent with the bins (how they lean, "
    "how they feel about an attribute) so it is less generic. Do NOT invent "
    "a proper name.\n"
    "4. Output only the sentences. No labels, bullets, or preamble."
)

# Per-key Bernoulli keep probs. Core identity kept more often; sparse
# situational fields drop more. Anything unlisted uses DEFAULT_KEEP_P.
_KEEP_P: dict[str, float] = {
    "age": 0.92,
    "age_band": 0.92,
    "sex": 0.88,
    "gender": 0.88,
    "race": 0.72,
    "education": 0.68,
    "income": 0.70,
    "income_band": 0.70,
    "party": 0.62,
    "ideology": 0.55,
    "tenure": 0.55,
    "commute_mode": 0.48,
    "household": 0.45,
    "children_under_18": 0.40,
    "owns_business": 0.35,
    "language": 0.40,
    "postal_code": 0.30,
}
DEFAULT_KEEP_P = 0.55

# synthetic attr pool for Polis (anonymous participants)
_SYNTHETIC_AGE_BANDS = ["18-24", "25-34", "35-44", "45-54", "55-64", "65+"]
_SYNTHETIC_TENURE = ["owner", "renter"]
_SYNTHETIC_COMMUTE = ["car", "transit", "walk", "bicycle", "other", "work from home"]
_SYNTHETIC_INCOME_BANDS = ["under $30k", "$30k-$60k", "$60k-$100k", "$100k-$150k", "over $150k"]
_SYNTHETIC_EDUCATION = ["high school", "some college", "bachelor's degree", "graduate degree"]
_SYNTHETIC_HOUSEHOLD = ["lives alone", "lives with a partner", "lives with roommates", "lives with family, incl. children"]


def generate_synthetic_attributes(rng: random.Random) -> dict[str, str]:
    """Fully-fabricated attrs for Polis. Tag persona_provenance=synthetic."""
    return {
        "age_band": rng.choice(_SYNTHETIC_AGE_BANDS),
        "tenure": rng.choice(_SYNTHETIC_TENURE),
        "commute_mode": rng.choice(_SYNTHETIC_COMMUTE),
        "income_band": rng.choice(_SYNTHETIC_INCOME_BANDS),
        "education": rng.choice(_SYNTHETIC_EDUCATION),
        "household": rng.choice(_SYNTHETIC_HOUSEHOLD),
    }


def attribute_dropout(
    attributes: dict[str, str],
    rng: random.Random,
    *,
    keep_probs: dict[str, float] | None = None,
    default_p: float = DEFAULT_KEEP_P,
    min_keep: int = 2,
    max_keep: int = 5,
) -> dict[str, str]:
    """Independent Bernoulli keep per attribute (key-specific p), then
    clamp to [min_keep, max_keep]. Order of surviving keys is shuffled so
    the verbalizer doesn't always see the same field order."""
    probs = keep_probs if keep_probs is not None else _KEEP_P
    keys = list(attributes.keys())
    kept_keys = [k for k in keys if rng.random() < probs.get(k, default_p)]
    if len(kept_keys) < min_keep:
        # force-add random missing ones until min_keep
        missing = [k for k in keys if k not in kept_keys]
        need = min(min_keep - len(kept_keys), len(missing))
        kept_keys.extend(rng.sample(missing, need) if need else [])
    if len(kept_keys) > max_keep:
        kept_keys = rng.sample(kept_keys, max_keep)
    rng.shuffle(kept_keys)
    return {k: attributes[k] for k in kept_keys}


def persona_to_text(attributes: dict[str, str], *, temperature: float = 0.95, max_tokens: int = 140) -> str:
    """LM verbalize: concrete sampled realization of the kept bins."""
    attr_lines = "\n".join(f"- {key.replace('_', ' ')}: {value}" for key, value in attributes.items())
    messages = [
        {"role": "system", "content": _VERBALIZE_SYSTEM_PROMPT},
        {"role": "user", "content": f"Attribute bins (sample specifics inside each):\n{attr_lines}"},
    ]
    return complete_chat(messages, temperature=temperature, max_tokens=max_tokens).strip()


def render_persona(
    attributes: dict[str, str],
    rng: random.Random,
    *,
    min_keep: int = 2,
    max_keep: int = 5,
) -> tuple[str, dict[str, str]]:
    """Bernoulli dropout -> shuffle -> verbalize. Shared by all sources."""
    cleaned = {k: str(v) for k, v in attributes.items() if v is not None and str(v).strip()}
    if not cleaned:
        cleaned = {"note": "ordinary resident"}
    kept = attribute_dropout(cleaned, rng, min_keep=min_keep, max_keep=max_keep)
    text = persona_to_text(kept)
    return text, kept
