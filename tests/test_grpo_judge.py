"""Judge unit + live checks: does OpenRouter MCQ mapping actually work?

Offline: parse_choice / prompt shape.
Live (needs OPENROUTER_API_KEY): clear opinion -> letter cases + a vague->none.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "model" / "grpo"))

from judge import parse_choice, judge_choice, judge_many, JUDGE_MODEL  # noqa: E402
from prompt import build_judge_prompt  # noqa: E402

SEED = 2262


def _have_openrouter() -> bool:
    return bool(os.environ.get("OPENROUTER_API_KEY") or os.environ.get("TECHTO_LLM_API_KEY"))


# --- offline ---

def test_parse_choice_basic():
    assert parse_choice("A") == "A"
    assert parse_choice("b") == "B"
    assert parse_choice("none") == "none"
    assert parse_choice("I pick C.") == "C"
    assert parse_choice("maybe D then") == "D"


def test_parse_choice_prefers_last_token():
    # chatter then final answer
    assert parse_choice("thinking... the answer is B") == "B"
    assert parse_choice("A or B? none") == "none"


def test_parse_choice_empty_and_garbage():
    assert parse_choice("") is None
    assert parse_choice("no letter here") is None
    assert parse_choice("E") is None  # only A-D/none


def test_build_judge_prompt_lists_options():
    p = build_judge_prompt(
        "I hate this idea.",
        "Favor or oppose X?",
        {"A": "Favor", "B": "Oppose"},
    )
    assert "Favor" in p and "Oppose" in p
    assert "OPINION:" in p
    assert "ONLY the single token" in p


# clear hand cases: opinion text strongly entails one option
_EASY_CASES = [
    (
        "I strongly oppose free college; taxpayers should not pay for other people's degrees.",
        "Would you favor or oppose making tuition free at public colleges?",
        {
            "A": "Strongly favor",
            "B": "Somewhat favor",
            "C": "Somewhat oppose",
            "D": "Strongly oppose",
        },
        "D",
    ),
    (
        "Free tuition would help working families and I support it completely.",
        "Would you favor or oppose making tuition free at public colleges?",
        {
            "A": "Strongly favor",
            "B": "Somewhat favor",
            "C": "Somewhat oppose",
            "D": "Strongly oppose",
        },
        "A",
    ),
    (
        "Businesses make way too much profit and exploit workers.",
        "Please choose the statement that comes closer to your own views.",
        {
            "A": "Business corporations make too much profit",
            "B": "Most corporations make a fair and reasonable amount of profit",
        },
        "A",
    ),
    (
        "Most companies earn a fair profit; I don't think they're gouging people.",
        "Please choose the statement that comes closer to your own views.",
        {
            "A": "Business corporations make too much profit",
            "B": "Most corporations make a fair and reasonable amount of profit",
        },
        "B",
    ),
    (
        "Climate change is a major problem for the country right now.",
        "How much of a problem is climate change?",
        {"A": "Major problem", "B": "Minor problem", "C": "Not a problem"},
        "A",
    ),
    (
        "Climate change is not really a problem in my view.",
        "How much of a problem is climate change?",
        {"A": "Major problem", "B": "Minor problem", "C": "Not a problem"},
        "C",
    ),
    (
        "I am very confident the economy will improve next year.",
        "How confident are you that the economy will improve?",
        {
            "A": "Very confident",
            "B": "Somewhat confident",
            "C": "Not too confident",
            "D": "Not at all confident",
        },
        "A",
    ),
    (
        "I have no confidence at all that things will get better.",
        "How confident are you that the economy will improve?",
        {
            "A": "Very confident",
            "B": "Somewhat confident",
            "C": "Not too confident",
            "D": "Not at all confident",
        },
        "D",
    ),
]


@pytest.mark.skipif(not _have_openrouter(), reason="OPENROUTER_API_KEY not set")
def test_judge_easy_cases_accuracy_floor():
    """Live judge: must get most clear entailment cases right (AGENTS 5.4 smoke)."""
    prompts = [build_judge_prompt(op, q, opts) for op, q, opts, _ in _EASY_CASES]
    golds = [g for *_, g in _EASY_CASES]
    preds = judge_many(prompts)
    assert len(preds) == len(golds)

    hits = sum(1 for p, g in zip(preds, golds) if p == g)
    acc = hits / len(golds)
    # print for humans watching the run
    print(f"\njudge model={JUDGE_MODEL} easy_acc={acc:.2f} ({hits}/{len(golds)})")
    for (op, q, opts, g), p in zip(_EASY_CASES, preds):
        mark = "ok" if p == g else "FAIL"
        print(f"  [{mark}] gold={g} pred={p} | {op[:60]}...")

    # floor: clear cases should be easy for a 7B instruct judge
    assert acc >= 0.75, f"judge too weak on easy set: acc={acc:.2f} preds={preds}"


@pytest.mark.skipif(not _have_openrouter(), reason="OPENROUTER_API_KEY not set")
def test_judge_vague_opinion_is_none_or_not_forced():
    # weather talk should not map onto a tuition MCQ
    p = build_judge_prompt(
        "I went for a walk today and the weather was nice.",
        "Would you favor or oppose making tuition free at public colleges?",
        {
            "A": "Strongly favor",
            "B": "Somewhat favor",
            "C": "Somewhat oppose",
            "D": "Strongly oppose",
        },
    )
    pred = judge_choice(p)
    print(f"\nvague-> {pred} (want none ideally)")
    # prefer none; if model guesses a letter thats a soft fail we still flag
    assert pred in ("none", "A", "B", "C", "D", None)
    assert pred == "none", f"vague opinion should be none, got {pred}"


@pytest.mark.skipif(not _have_openrouter(), reason="OPENROUTER_API_KEY not set")
def test_judge_many_parallel_matches_serial_on_one_prompt():
    p = build_judge_prompt(
        "I strongly favor this policy.",
        "Favor or oppose?",
        {"A": "Favor", "B": "Oppose"},
    )
    a = judge_choice(p)
    b = judge_many([p, p, p])
    assert a is not None
    assert all(x == a for x in b), f"parallel inconsistency: serial={a} many={b}"
