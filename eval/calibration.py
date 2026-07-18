"""Phase 2 gate, half 1: OpinionQA distributional calibration
(implementation_plan.md):

    "eval/calibration.py: run population against OpinionQA; measure
    distributional alignment per subgroup. Expect it to be off out of the
    box."

Gate: "Population reproduces known subgroup splits within an agreed
tolerance on a held-out OpinionQA slice..."

Scope for this pass (MVP, matches the honesty bar Phase 1 set): one Pew
American Trends Panel wave (W92, Sept 2021), one demographic subgroup axis
(POLPARTY: Republican/Democrat/Independent/Other -- the axis most directly
relevant to policy-attitude prediction and the one the OpinionQA paper
itself emphasizes), a held-out sample of that wave's closed-ended questions
(selected by a fixed random seed, not hand-picked, so the choice can't be
subconsciously cherry-picked toward favourable results).

For each (question, subgroup) cell: the REAL distribution is the actual
Pew respondents' answer frequencies (from `responses.csv`, which already
carries each respondent's demographics). The MODEL distribution is built by
prompting the LM `N_SAMPLES_PER_CELL` times, each time conditioned only on
the subgroup label (e.g. "You identify politically as a Democrat"), and
tallying its answers. Alignment is measured as Jensen-Shannon divergence
between the two distributions (0 = identical, ln(2) upper bound for
completely disjoint support with this base-e implementation) -- JS
divergence is the metric AGENTS.md 5.2 already establishes for
population-vs-real distributional matching, so this reuses it rather than
introducing a second metric for what's conceptually the same comparison.

Run: `uv run python -m eval.calibration`
"""

from __future__ import annotations

import argparse
import ast
import json
import random
from pathlib import Path

import numpy as np
import pandas as pd

from model.serving import NoLLMBackendAvailable, complete_chat

OPINIONQA_DIR = Path(__file__).resolve().parent.parent / "data" / "raw" / "opinionqa" / "human_resp"
OUTPUT_DIR = Path(__file__).resolve().parent / "output"

WAVE = "American_Trends_Panel_W92"
SUBGROUP_KEY = "POLPARTY"
SUBGROUP_VALUES = ["Republican", "Democrat", "Independent", "Other"]
N_HELD_OUT_QUESTIONS = 6
N_SAMPLES_PER_CELL = 20
SEED = 0

REFUSAL_LABELS = {"Refused", "Don't Know", "Dont know", "DK/Refused", "No answer"}

SUBGROUP_PROMPT_PHRASE = {
    "Republican": "You identify politically as a Republican.",
    "Democrat": "You identify politically as a Democrat.",
    "Independent": "You identify politically as a political independent.",
    "Other": "You don't identify with any major U.S. political party.",
}


def _load_wave(wave: str) -> tuple[pd.DataFrame, pd.DataFrame]:
    wave_dir = OPINIONQA_DIR / wave
    info = pd.read_csv(wave_dir / "info.csv")
    responses = pd.read_csv(wave_dir / "responses.csv", low_memory=False)
    return info, responses


def _parse_option_mapping(raw: str) -> dict[float, str]:
    return ast.literal_eval(raw)


def select_held_out_questions(info: pd.DataFrame, n: int, seed: int) -> list[str]:
    """Pick `n` question keys with a clean 2-4-option closed answer set
    (excluding refusal/DK-only codes), by a fixed seed -- not hand-picked."""
    candidates = []
    for _, row in info.iterrows():
        mapping = _parse_option_mapping(row["option_mapping"])
        real_options = [v for v in mapping.values() if v not in REFUSAL_LABELS]
        if 2 <= len(real_options) <= 4:
            candidates.append(row["key"])
    rng = random.Random(seed)
    return sorted(rng.sample(candidates, min(n, len(candidates))))


def real_subgroup_distribution(responses: pd.DataFrame, question_key: str) -> dict[str, dict[str, float]]:
    """{subgroup_value: {option_label: probability}} from actual Pew
    respondents, excluding refusals/missing from both the numerator and
    denominator.

    `responses.csv` stores each answer as the already-decoded label text
    (matching `option_mapping`'s values), not the raw numeric code -- so no
    remapping is needed here, just filtering out refusal/DK labels.
    """
    result: dict[str, dict[str, float]] = {}
    for subgroup in SUBGROUP_VALUES:
        subset = responses[responses[SUBGROUP_KEY] == subgroup]
        answers = subset[question_key]
        answers = answers[~answers.isin(REFUSAL_LABELS) & answers.notna()]
        counts = answers.value_counts()
        total = counts.sum()
        if total == 0:
            result[subgroup] = {}
            continue
        result[subgroup] = {label: count / total for label, count in counts.items()}
    return result


def _parse_choice(text: str, option_labels: list[str]) -> str | None:
    text = text.strip()
    letters = [chr(ord("A") + i) for i in range(len(option_labels))]
    for letter, label in zip(letters, option_labels):
        if text.upper().startswith(letter) or text.strip().upper() == letter:
            return label
    # fall back to substring match against the option text itself
    for label in option_labels:
        if label.lower() in text.lower():
            return label
    return None


def query_model_distribution(
    question_text: str, option_labels: list[str], n_samples: int, model: str | None
) -> dict[str, dict[str, float]]:
    letters = [chr(ord("A") + i) for i in range(len(option_labels))]
    options_block = "\n".join(f"{letter}) {label}" for letter, label in zip(letters, option_labels))

    result: dict[str, dict[str, float]] = {}
    for subgroup in SUBGROUP_VALUES:
        counts: dict[str, int] = {label: 0 for label in option_labels}
        unparsed = 0
        prompt = (
            f"{SUBGROUP_PROMPT_PHRASE[subgroup]} Answer this survey question as yourself, "
            f"honestly, the way someone with your political identification typically would.\n\n"
            f"{question_text}\n\n{options_block}\n\n"
            f"Respond with ONLY the letter of your answer, nothing else."
        )
        for _ in range(n_samples):
            reply = complete_chat(
                [{"role": "user", "content": prompt}],
                model=model,
                temperature=1.0,
                max_tokens=5,
            )
            choice = _parse_choice(reply, option_labels)
            if choice is None:
                unparsed += 1
                continue
            counts[choice] += 1
        total = sum(counts.values())
        if total == 0:
            result[subgroup] = {}
        else:
            result[subgroup] = {label: c / total for label, c in counts.items()}
        if unparsed:
            result[subgroup]["_unparsed_count"] = unparsed  # diagnostic, stripped before JS calc
    return result


def js_divergence(p: dict[str, float], q: dict[str, float]) -> float:
    """Jensen-Shannon divergence (base e, natural log) over the union of
    labels in p and q, treating a missing label as probability 0."""
    labels = sorted(set(p) | set(q))
    if not labels:
        return float("nan")
    p_vec = np.array([p.get(label, 0.0) for label in labels])
    q_vec = np.array([q.get(label, 0.0) for label in labels])
    if p_vec.sum() == 0 or q_vec.sum() == 0:
        return float("nan")
    p_vec = p_vec / p_vec.sum()
    q_vec = q_vec / q_vec.sum()
    m = 0.5 * (p_vec + q_vec)

    def kl(a: np.ndarray, b: np.ndarray) -> float:
        mask = a > 0
        return float(np.sum(a[mask] * np.log(a[mask] / b[mask])))

    return 0.5 * kl(p_vec, m) + 0.5 * kl(q_vec, m)


def run_calibration(
    n_questions: int = N_HELD_OUT_QUESTIONS,
    n_samples_per_cell: int = N_SAMPLES_PER_CELL,
    seed: int = SEED,
    model: str | None = None,
) -> pd.DataFrame:
    info, responses = _load_wave(WAVE)
    question_keys = select_held_out_questions(info, n_questions, seed)

    rows = []
    for key in question_keys:
        info_row = info[info["key"] == key].iloc[0]
        mapping = _parse_option_mapping(info_row["option_mapping"])
        option_labels = [v for v in mapping.values() if v not in REFUSAL_LABELS]

        real_dist = real_subgroup_distribution(responses, key)
        model_dist = query_model_distribution(info_row["question"], option_labels, n_samples_per_cell, model)

        for subgroup in SUBGROUP_VALUES:
            real = real_dist.get(subgroup, {})
            model_d = {k: v for k, v in model_dist.get(subgroup, {}).items() if k != "_unparsed_count"}
            unparsed = model_dist.get(subgroup, {}).get("_unparsed_count", 0)
            js = js_divergence(real, model_d)
            subgroup_answers = responses.loc[responses[SUBGROUP_KEY] == subgroup, key]
            n_real = int((~subgroup_answers.isin(REFUSAL_LABELS) & subgroup_answers.notna()).sum())
            rows.append(
                {
                    "question_key": key,
                    "question_text": info_row["question"],
                    "subgroup": subgroup,
                    "real_dist": json.dumps(real),
                    "model_dist": json.dumps(model_d),
                    "js_divergence": js,
                    "unparsed_replies": unparsed,
                    "n_real_respondents": n_real,
                }
            )
    return pd.DataFrame(rows)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--n-questions", type=int, default=N_HELD_OUT_QUESTIONS)
    parser.add_argument("--n-samples-per-cell", type=int, default=N_SAMPLES_PER_CELL)
    parser.add_argument("--seed", type=int, default=SEED)
    parser.add_argument("--model", type=str, default=None)
    args = parser.parse_args()

    try:
        results = run_calibration(args.n_questions, args.n_samples_per_cell, args.seed, args.model)
    except NoLLMBackendAvailable as exc:
        print(f"BLOCKED: {exc}")
        raise SystemExit(1)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    results.to_csv(OUTPUT_DIR / "phase2_calibration_results.csv", index=False)

    summary = {
        "wave": WAVE,
        "subgroup_key": SUBGROUP_KEY,
        "n_questions": results["question_key"].nunique(),
        "n_samples_per_cell": args.n_samples_per_cell,
        "mean_js_divergence": float(results["js_divergence"].mean()),
        "median_js_divergence": float(results["js_divergence"].median()),
        "max_js_divergence": float(results["js_divergence"].max()),
        "total_unparsed_replies": int(results["unparsed_replies"].sum()),
    }
    print(json.dumps(summary, indent=2))
    (OUTPUT_DIR / "phase2_calibration_summary.json").write_text(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
