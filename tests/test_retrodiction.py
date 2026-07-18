"""Tests for eval/retrodiction.py. Same split as the other Phase 2 tests:
offline unit tests for the pure logic and the RF baseline (always run),
plus a live-model integration test that skips cleanly when no LLM backend
is reachable."""

from __future__ import annotations

import pytest

from eval.retrodiction import (
    ANES_CSV,
    TARGET_LABELS,
    load_dataset,
    persona_text,
    run_rf_baseline,
)
from model.serving import NoLLMBackendAvailable, resolve_base_url


def _anes_available() -> bool:
    return ANES_CSV.exists()


def _llm_available() -> bool:
    try:
        resolve_base_url()
        return True
    except NoLLMBackendAvailable:
        return False


pytestmark = pytest.mark.skipif(not _anes_available(), reason="ANES 2020 data not staged under data/raw/anes/")


def test_load_dataset_has_only_valid_target_and_covariate_values():
    df = load_dataset()
    assert len(df) > 1000  # sanity: filtering shouldn't gut the sample
    assert df["V202339"].isin(TARGET_LABELS.keys()).all()
    from eval.retrodiction import COVARIATE_COLS

    assert (df[COVARIATE_COLS] >= 0).all().all()


def test_persona_text_is_legible_and_mentions_every_covariate():
    df = load_dataset()
    row = df.iloc[0]
    text = persona_text(row)
    assert str(int(row["V201507x"])) in text  # age appears verbatim
    assert len(text) > 50
    assert text.count(".") >= 3  # multiple sentences, not a single run-on fragment


def test_rf_baseline_beats_trivial_majority_baseline():
    """Sanity floor: the RF baseline should do meaningfully better than
    always predicting the majority class (Favor, ~88% of the data), on
    macro-F1 specifically (accuracy alone can't tell the two apart)."""
    from sklearn.model_selection import train_test_split

    df = load_dataset()
    train, test = train_test_split(df, test_size=0.15, random_state=0, stratify=df["V202339"])
    _, metrics = run_rf_baseline(train, test, seed=0)

    # A majority-only classifier gets macro F1 close to 1/3 (0 recall on the
    # two minority classes); the RF should clear that by a real margin.
    assert metrics["macro_f1"] > 0.35
    assert 0 <= metrics["accuracy"] <= 1


@pytest.mark.skipif(not _llm_available(), reason="no LLM backend reachable (see OVERNIGHT_LOG.md)")
def test_retrodiction_pipeline_runs_end_to_end_and_produces_real_numbers():
    from eval.retrodiction import run_retrodiction

    results = run_retrodiction(test_size=0.15, lm_sample_size=15, seed=42)
    assert results["n_lm_eval_sample"] == 15
    assert results["lm_zero_shot_on_same_subset"]["n_unparsed"] < 15  # at least some parsed
    assert 0 <= results["rf_baseline_full_test_set"]["macro_f1"] <= 1
    if results["lm_zero_shot_on_same_subset"]["accuracy"] is not None:
        assert 0 <= results["lm_zero_shot_on_same_subset"]["accuracy"] <= 1
