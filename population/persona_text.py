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

import functools
import json
import random
from pathlib import Path

import pandas as pd

from model.serving import complete_chat

REPO_ROOT = Path(__file__).resolve().parent.parent
PROCESSED_DIR = REPO_ROOT / "data" / "processed"

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
    "4. If neighbourhood background context is given, you may use it for one "
    "brief, natural mention (e.g. a passing reference to the area) -- never "
    "recite it as a fact dump, and never let it override or contradict the "
    "attribute bins.\n"
    "5. Output only the sentences. No labels, bullets, or preamble."
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


def persona_to_text(
    attributes: dict[str, str],
    *,
    narrative_context: str | None = None,
    temperature: float = 0.95,
    max_tokens: int = 140,
) -> str:
    """LM verbalize: concrete sampled realization of the kept bins, with an
    optional neighbourhood narrative snippet as light background context
    (never a new attribute bin -- see module docstring's rendering
    contract)."""
    attr_lines = "\n".join(f"- {key.replace('_', ' ')}: {value}" for key, value in attributes.items())
    user_content = f"Attribute bins (sample specifics inside each):\n{attr_lines}"
    if narrative_context:
        user_content += (
            "\n\nBackground context about the neighbourhood (for at most one "
            f"brief, natural mention -- not a fact dump): {narrative_context}"
        )
    messages = [
        {"role": "system", "content": _VERBALIZE_SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]
    return complete_chat(messages, temperature=temperature, max_tokens=max_tokens).strip()


def render_persona(
    attributes: dict[str, str],
    rng: random.Random,
    *,
    narrative_context: str | None = None,
    min_keep: int = 2,
    max_keep: int = 5,
) -> tuple[str, dict[str, str]]:
    """Bernoulli dropout -> shuffle -> verbalize. Shared by all sources."""
    cleaned = {k: str(v) for k, v in attributes.items() if v is not None and str(v).strip()}
    if not cleaned:
        cleaned = {"note": "ordinary resident"}
    kept = attribute_dropout(cleaned, rng, min_keep=min_keep, max_keep=max_keep)
    text = persona_to_text(kept, narrative_context=narrative_context)
    return text, kept


@functools.lru_cache(maxsize=1)
def _load_narratives() -> dict:
    path = PROCESSED_DIR / "neighbourhood_narratives.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text())


@functools.lru_cache(maxsize=1)
def _load_ces() -> pd.DataFrame:
    path = PROCESSED_DIR / "ces_ontario.csv"
    if not path.exists():
        return pd.DataFrame()
    return pd.read_csv(path)


def neighbourhood_narrative(neighbourhood_code: str) -> str | None:
    """Best-effort Wikipedia extract for a neighbourhood code, or None if
    none was found (data/ingest_wikipedia_narratives.py; ~73% coverage) --
    context only, never fabricated, never an attribute bin."""
    entry = _load_narratives().get(neighbourhood_code)
    return entry["extract"] if entry else None


_CES_GENDER_MAP = {"Woman+": "A woman", "Man+": "A man"}
_IDEOLOGY_LABELS = {"left": "left-leaning", "centre": "centrist", "right": "right-leaning"}


def match_ces_attitude(age_band: str, gender: str | None, rng: random.Random) -> dict[str, str]:
    """Attach real party ID / left-right ideology from a CES Ontario
    respondent matched on age bucket + gender -- so party/ideology
    co-varies with demographics the way it really does, rather than being
    assigned independently at random. Children (age_band '0-14') get
    nothing back, matching reality (no party affiliation)."""
    if age_band == "0-14":
        return {}
    ces = _load_ces()
    if ces.empty:
        return {}

    is_senior = age_band == "65+"
    pool = ces[ces["age"] >= 65] if is_senior else ces[ces["age"] < 65]
    gender_target = _CES_GENDER_MAP.get(gender)
    if gender_target:
        narrowed = pool[pool["gender"] == gender_target]
        if len(narrowed) > 0:
            pool = narrowed
    if pool.empty:
        pool = ces

    row = pool.sample(n=1, random_state=rng.randint(0, 2**31 - 1)).iloc[0]
    result: dict[str, str] = {}
    if pd.notna(row["party_id"]):
        result["party"] = row["party_id"]
    scale = row["ideology_lr_scale"]
    if pd.notna(scale):
        if scale <= 3:
            result["ideology"] = _IDEOLOGY_LABELS["left"]
        elif scale >= 7:
            result["ideology"] = _IDEOLOGY_LABELS["right"]
        else:
            result["ideology"] = _IDEOLOGY_LABELS["centre"]
    return result


def persona_attributes_from_sampler(persona, rng: random.Random) -> dict[str, str]:
    """Build the verbalizer attribute dict for a population.sampler.Persona:
    real PUMF joint attributes plus CES-matched party/ideology. No field is
    fabricated -- missing PUMF values (e.g. commute_mode for a
    non-commuter) simply aren't included."""
    attrs: dict[str, str] = {
        "age_band": persona.age_band,
        "tenure": persona.tenure,
        "commute_mode": persona.commute_mode,
        "gender": persona.gender,
        "education": persona.education,
        "immigration_status": persona.immigration_status,
        "generation_status": persona.generation_status,
        "visible_minority": persona.visible_minority,
        "dwelling_type": persona.dwelling_type,
        "household_type": persona.household_type,
        "family_status": persona.family_status,
        "household_income": persona.household_income_band,
    }
    attrs.update(match_ces_attitude(persona.age_band, persona.gender, rng))
    return attrs


def render_persona_from_sampler(persona, rng: random.Random) -> tuple[str, dict[str, str]]:
    """End-to-end: sampler.Persona -> verbalizer attribute dict (real PUMF
    joint attributes + CES-matched party/ideology) -> dropout -> LM
    verbalize, with the neighbourhood's Wikipedia narrative (if any) as
    light background context."""
    attrs = persona_attributes_from_sampler(persona, rng)
    narrative = neighbourhood_narrative(persona.neighbourhood_code)
    return render_persona(attrs, rng, narrative_context=narrative)
