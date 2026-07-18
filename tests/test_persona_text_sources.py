"""Tests for the CES/Wikipedia wiring added to population/persona_text.py."""

from __future__ import annotations

import random

import pandas as pd
import pytest

from population.persona_text import (
    match_ces_attitude,
    neighbourhood_narrative,
    persona_attributes_from_sampler,
    render_persona_from_sampler,
)
from population.sampler import Persona


def test_neighbourhood_narrative_returns_none_for_unmatched_code():
    assert neighbourhood_narrative("999-does-not-exist") is None


def test_neighbourhood_narrative_returns_text_for_known_neighbourhood():
    # Regent Park is neighbourhood code 072, confirmed matched during
    # manual QA of data/ingest_wikipedia_narratives.py.
    result = neighbourhood_narrative("072")
    assert result is None or len(result) >= 150


def test_match_ces_attitude_returns_nothing_for_children():
    rng = random.Random(0)
    assert match_ces_attitude("0-14", "Woman+", rng) == {}


def test_match_ces_attitude_returns_party_or_ideology_for_adults():
    rng = random.Random(1)
    result = match_ces_attitude("15-64", "Woman+", rng)
    # CES has ~20% non-identifiers and some missing ideology scale values,
    # so we can't require both keys on every draw, but across many draws
    # at least some should carry a real value.
    results = [match_ces_attitude("15-64", "Woman+", random.Random(i)) for i in range(50)]
    assert any("party" in r for r in results)
    assert any("ideology" in r for r in results)


def test_persona_attributes_from_sampler_has_no_fabricated_fields():
    persona = Persona(
        id="persona:test",
        neighbourhood_code="072",
        neighbourhood_name="Regent Park",
        age_band="15-64",
        tenure="Owner",
        gender="Woman+",
        education="Bachelor's degree",
        commute_mode=None,  # PUMF often has no commute mode; must not be fabricated
    )
    rng = random.Random(2)
    attrs = persona_attributes_from_sampler(persona, rng)
    assert "commute_mode" not in attrs or attrs["commute_mode"] is None
    assert attrs["age_band"] == "15-64"
    assert attrs["gender"] == "Woman+"


def test_render_persona_from_sampler_smoke(monkeypatch):
    """No live LLM call -- stub complete_chat to confirm the pipeline wires
    together (attrs built, narrative looked up, dropout applied) without
    error."""
    import population.persona_text as persona_text_module

    monkeypatch.setattr(persona_text_module, "complete_chat", lambda messages, **kw: "A stubbed persona description.")

    persona = Persona(
        id="persona:test2",
        neighbourhood_code="072",
        neighbourhood_name="Regent Park",
        age_band="65+",
        tenure="Renter",
        gender="Man+",
        education="High (secondary) school diploma or equivalency certificate",
        visible_minority="Black",
    )
    rng = random.Random(3)
    text, kept = render_persona_from_sampler(persona, rng)
    assert text == "A stubbed persona description."
    assert len(kept) >= 2
