"""Sanity checks on data/ingest_wikipedia_narratives.py's output."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

PROCESSED_DIR = Path(__file__).resolve().parent.parent / "data" / "processed"

_WRONG_ENTITY_TYPE_PATTERNS = (
    "is a river", "is a stream", "is a creek", "is a street", "is a road",
    "is a park", "is a school", "is a shopping", "is a mall",
)


@pytest.fixture(scope="module")
def narratives() -> dict:
    path = PROCESSED_DIR / "neighbourhood_narratives.json"
    assert path.exists(), "run `uv run python -m data.ingest_wikipedia_narratives` first"
    return json.loads(path.read_text())


def test_majority_of_neighbourhoods_matched(narratives: dict):
    # Best-effort, not required to be complete -- but most of the 158
    # neighbourhoods should have found something.
    assert len(narratives) >= 100


def test_no_wrong_entity_type_matches(narratives: dict):
    for code, entry in narratives.items():
        opening = entry["extract"].lower()[:120]
        assert not any(p in opening for p in _WRONG_ENTITY_TYPE_PATTERNS), (
            f"{code} ({entry['neighbourhood_name']}) matched a non-neighbourhood entity: {entry['wikipedia_title']}"
        )


def test_every_entry_has_required_fields(narratives: dict):
    for code, entry in narratives.items():
        assert entry.get("neighbourhood_name")
        assert entry.get("wikipedia_title")
        assert entry.get("extract")
        assert len(entry["extract"]) >= 150
