"""Phase 1 gate (implementation_plan.md):

    "For one hand-authored policy, the pipeline produces a heatmap where
    directly-affected areas differ visibly from unaffected ones. Eyeball
    sanity only; calibration comes next."

Split into two tests:

  - `test_apply_hand_authored_policy_produces_real_twin_diff` needs no LLM
    and always runs: confirms the hand-authored policy is applied as a real
    `patch()` on the twin (versioned, diffed), reusing Phase 0's compiler
    rather than a parallel one-off "add a stop" path.

  - `test_pipeline_runs_end_to_end_and_produces_nondegenerate_output` is a
    live-model integration test. It skips (not fails) when no LLM backend is
    reachable -- per the coordinator's instruction not to fake sampled
    output when there's no GPU/model access, this test's absence of a run is
    itself the honest signal, not a forced pass. When a backend IS reachable
    (this session: local vLLM serving Qwen2.5-7B-Instruct), it runs the
    pipeline at a modest persona count and checks the plumbing: personas are
    sampled, opinions are generated, scores are non-degenerate (real
    variance, not every persona getting the same number), and the heatmap
    file is produced.

    It deliberately does NOT assert `near.mean() > far.mean()` on every run.
    That directional claim is real (see OVERNIGHT_LOG.md: a single n=362
    run gave near-far = +0.033 with a bootstrap 95% CI of [0.005, 0.063],
    excluding zero), but it is a small effect that a 60-150-persona sample
    can and did flip sign on during development purely from LLM sampling
    noise -- asserting it on every small test run would make the suite
    flaky for the wrong reason (real small-sample variance, not a bug).
    The gate's own text says "eyeball sanity only, calibration comes next"
    (Phase 2); treating a noisy small-n directional check as a hard
    pass/fail here would overclaim precision Phase 1 was never meant to
    have. The actual directional evidence is a one-time, adequately-powered,
    reproducible run, documented with real numbers in OVERNIGHT_LOG.md, not
    a per-test-run assertion.
"""

from __future__ import annotations

import pytest

from eval.heatmap_phase1 import apply_hand_authored_policy, run_pipeline
from model.serving import NoLLMBackendAvailable, resolve_base_url
from twin.diff import diff
from twin.state import TwinState


def _llm_available() -> bool:
    try:
        resolve_base_url()
        return True
    except NoLLMBackendAvailable:
        return False


def test_apply_hand_authored_policy_produces_real_twin_diff(base_state: TwinState):
    new_state, stop_xy = apply_hand_authored_policy(base_state)

    assert new_state.version == base_state.version + 1
    added_stop = new_state.get("transit_stops", "transit_stops:phase1-new-stop")
    assert added_stop is not None
    assert added_stop.geometry.coordinates[0] == pytest.approx(stop_xy[0])

    d = diff(base_state, new_state)
    assert "transit_stops:phase1-new-stop" in d.layers["transit_stops"].added
    assert not d.is_empty


@pytest.mark.skipif(not _llm_available(), reason="no LLM backend reachable (see OVERNIGHT_LOG.md)")
def test_pipeline_runs_end_to_end_and_produces_nondegenerate_output(tmp_path):
    results = run_pipeline(n_personas=60, seed=123, model=None, max_tokens=150)
    assert len(results) >= 30  # sanity: sampling + LLM calls actually produced rows

    near = results[results["near"]]["opinion_score"]
    far = results[~results["near"]]["opinion_score"]
    assert len(near) >= 5 and len(far) >= 5, "near/far split too small to compare -- check NEAR_THRESHOLD_M"

    # Real LM output, not a stub: opinions are non-empty text, and opinion_score
    # actually varies across personas (a constant score for everyone would
    # mean the scorer or the LM call path is broken, not just imprecise).
    assert results["opinion_text"].str.len().min() > 0
    assert results["opinion_score"].std() > 0.01

    from eval.heatmap_phase1 import render_heatmap

    out_path = tmp_path / "heatmap.png"
    agg = render_heatmap(results, out_path)
    assert out_path.exists() and out_path.stat().st_size > 0
    assert agg["mean"].dropna().nunique() > 1  # not every neighbourhood got an identical score
