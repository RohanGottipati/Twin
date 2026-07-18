"""Tests for eval/calibration.py. Split the same way as Phase 1: offline
unit tests for the pure logic (always run), plus a live-model integration
test that skips cleanly when no LLM backend is reachable."""

from __future__ import annotations

import pytest

from eval.calibration import (
    OPINIONQA_DIR,
    WAVE,
    js_divergence,
    real_subgroup_distribution,
    run_calibration,
    select_held_out_questions,
)
from model.serving import NoLLMBackendAvailable, resolve_base_url


def _opinionqa_available() -> bool:
    return (OPINIONQA_DIR / WAVE / "info.csv").exists()


def _llm_available() -> bool:
    try:
        resolve_base_url()
        return True
    except NoLLMBackendAvailable:
        return False


pytestmark = pytest.mark.skipif(
    not _opinionqa_available(), reason="OpinionQA data not staged under data/raw/opinionqa/"
)


def test_js_divergence_identical_distributions_is_zero():
    d = {"A": 0.5, "B": 0.5}
    assert js_divergence(d, d) == pytest.approx(0.0, abs=1e-9)


def test_js_divergence_disjoint_distributions_is_positive():
    p = {"A": 1.0}
    q = {"B": 1.0}
    js = js_divergence(p, q)
    assert js > 0.5  # close to ln(2), the base-e JS upper bound for disjoint support


def test_js_divergence_is_symmetric():
    p = {"A": 0.8, "B": 0.2}
    q = {"A": 0.3, "B": 0.7}
    assert js_divergence(p, q) == pytest.approx(js_divergence(q, p))


def test_js_divergence_handles_missing_labels_as_zero_probability():
    p = {"A": 1.0}
    q = {"A": 0.5, "B": 0.5}
    js = js_divergence(p, q)
    assert 0 < js < 1


def test_select_held_out_questions_is_deterministic_given_seed():
    from eval.calibration import _load_wave

    info, _ = _load_wave(WAVE)
    a = select_held_out_questions(info, 6, seed=0)
    b = select_held_out_questions(info, 6, seed=0)
    assert a == b


def test_select_held_out_questions_only_picks_closed_ended_low_cardinality():
    from eval.calibration import REFUSAL_LABELS, _load_wave, _parse_option_mapping

    info, _ = _load_wave(WAVE)
    keys = select_held_out_questions(info, 10, seed=1)
    assert len(keys) > 0
    for key in keys:
        row = info[info["key"] == key].iloc[0]
        mapping = _parse_option_mapping(row["option_mapping"])
        real_options = [v for v in mapping.values() if v not in REFUSAL_LABELS]
        assert 2 <= len(real_options) <= 4


def test_real_subgroup_distribution_sums_to_one_per_subgroup():
    from eval.calibration import _load_wave

    info, responses = _load_wave(WAVE)
    keys = select_held_out_questions(info, 3, seed=2)
    for key in keys:
        dist = real_subgroup_distribution(responses, key)
        for subgroup, probs in dist.items():
            if probs:
                assert sum(probs.values()) == pytest.approx(1.0, abs=1e-6), f"{key}/{subgroup}"


@pytest.mark.skipif(not _llm_available(), reason="no LLM backend reachable (see OVERNIGHT_LOG.md)")
def test_calibration_pipeline_runs_end_to_end_and_produces_real_numbers():
    df = run_calibration(n_questions=1, n_samples_per_cell=4, seed=99)
    assert len(df) == 4  # 1 question x 4 subgroups
    assert df["js_divergence"].notna().all()
    assert (df["js_divergence"] >= 0).all()
    # Model distributions should be real probability distributions.
    import json

    for raw in df["model_dist"]:
        d = json.loads(raw)
        if d:
            assert sum(d.values()) == pytest.approx(1.0, abs=1e-6)
