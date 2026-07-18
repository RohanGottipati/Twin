"""Phase 2 gate, half 2: ANES individual-level retrodiction
(implementation_plan.md):

    "eval/retrodiction.py: condition personas on real ANES/CES respondents;
    measure individual-level accuracy (JS distance for distributions, F1
    for prediction). Stand up a random-forest baseline as the fair thing
    to beat."

Gate: "...beats (or matches with legible reasons) the RF baseline on ANES
individual retrodiction."

Target variable: V202339, "Favor/oppose background checks for gun purchases
at gun shows or other private sales" (Favor/Oppose/Neither) -- a clean,
well-covered (6,696 valid respondents after filtering), 3-class closed
policy-attitude item in the 2020 Time Series Study, chosen because it's a
concrete policy stance (not a demographic covariate masquerading as an
opinion) with enough minority-class representation to make macro-F1
meaningful, unlike near-unanimous items.

Persona covariates (all from ANES's own demographic summary variables, the
same fields a Toronto SFT row's `input` would eventually carry): age,
education, race, sex, party identification, political ideology, family
income.

Two models compared on the SAME held-out test respondents, not just
independently-reported numbers -- an RF trained on the OTHER respondents'
covariates -> target, and the LM prompted zero-shot with each held-out
respondent's persona (never given their actual answer).

Run: `uv run python -m eval.retrodiction`
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, f1_score
from sklearn.model_selection import train_test_split

from eval.calibration import js_divergence
from model.serving import NoLLMBackendAvailable, complete_chat

ANES_DIR = Path(__file__).resolve().parent.parent / "data" / "raw" / "anes" / "anes_timeseries_2020_csv_20220210"
ANES_CSV = ANES_DIR / "anes_timeseries_2020_csv_20220210.csv"
OUTPUT_DIR = Path(__file__).resolve().parent / "output"

TARGET_COL = "V202339"
TARGET_LABELS = {1: "Favor", 2: "Oppose", 3: "Neither"}
TARGET_QUESTION = (
    "Do you favor, oppose, or neither favor nor oppose requiring background checks for gun "
    "purchases at gun shows or other private sales?"
)

COVARIATE_COLS = ["V201507x", "V201510", "V201549x", "V201600", "V201231x", "V201200", "V201617x"]

EDUCATION_LABELS = {
    1: "less than high school",
    2: "a high school diploma",
    3: "some college but no degree",
    4: "an associate degree (occupational/vocational)",
    5: "an associate degree (academic)",
    6: "a bachelor's degree",
    7: "a master's degree",
    8: "a professional or doctoral degree",
    95: "some other level of education",
}
RACE_LABELS = {
    1: "White, non-Hispanic",
    2: "Black, non-Hispanic",
    3: "Hispanic",
    4: "Asian or Native Hawaiian/Pacific Islander, non-Hispanic",
    5: "Native American/Alaska Native or other race, non-Hispanic",
    6: "multiracial, non-Hispanic",
}
SEX_LABELS = {1: "male", 2: "female"}
PARTY_LABELS = {
    1: "a strong Democrat",
    2: "a not-very-strong Democrat",
    3: "an independent leaning Democrat",
    4: "a political independent",
    5: "an independent leaning Republican",
    6: "a not-very-strong Republican",
    7: "a strong Republican",
}
IDEOLOGY_LABELS = {
    1: "extremely liberal",
    2: "liberal",
    3: "slightly liberal",
    4: "moderate, middle of the road",
    5: "slightly conservative",
    6: "conservative",
    7: "extremely conservative",
    99: "not someone who has thought much about ideological labels",
}
INCOME_LABELS = {
    1: "under $10,000",
    2: "$10,000-$14,999",
    3: "$15,000-$19,999",
    4: "$20,000-$24,999",
    5: "$25,000-$29,999",
    6: "$30,000-$34,999",
    7: "$35,000-$39,999",
    8: "$40,000-$44,999",
    9: "$45,000-$49,999",
    10: "$50,000-$59,999",
    11: "$60,000-$64,999",
    12: "$65,000-$69,999",
    13: "$70,000-$74,999",
    14: "$75,000-$79,999",
    15: "$80,000-$89,999",
    16: "$90,000-$99,999",
    17: "$100,000-$109,999",
    18: "$110,000-$124,999",
    19: "$125,000-$149,999",
    20: "$150,000-$174,999",
    21: "$175,000-$249,999",
    22: "$250,000 or more",
}

TEST_SIZE = 0.15
LM_EVAL_SAMPLE_SIZE = 60
SEED = 0


def load_dataset() -> pd.DataFrame:
    df = pd.read_csv(ANES_CSV, low_memory=False)
    cols = COVARIATE_COLS + [TARGET_COL]
    sub = df[cols].copy()
    valid = (sub[COVARIATE_COLS] >= 0).all(axis=1) & sub[TARGET_COL].isin(TARGET_LABELS.keys())
    return sub[valid].reset_index(drop=True)


def persona_text(row: pd.Series) -> str:
    return (
        f"You are {int(row['V201507x'])} years old, with {EDUCATION_LABELS[int(row['V201510'])]}. "
        f"You are {RACE_LABELS[int(row['V201549x'])]} and {SEX_LABELS[int(row['V201600'])]}. "
        f"Politically, you are {PARTY_LABELS[int(row['V201231x'])]}, and you describe your views as "
        f"{IDEOLOGY_LABELS[int(row['V201200'])]}. Your household income is {INCOME_LABELS[int(row['V201617x'])]}."
    )


def _rf_features(df: pd.DataFrame) -> pd.DataFrame:
    """One-hot the nominal covariates (race, sex), keep the ordinal ones
    (education, party id, ideology, income) and age as numeric -- a
    standard, unremarkable encoding choice for a tabular RF baseline."""
    features = df[["V201507x", "V201510", "V201231x", "V201200", "V201617x"]].copy()
    features = features.join(pd.get_dummies(df["V201549x"], prefix="race"))
    features = features.join(pd.get_dummies(df["V201600"], prefix="sex"))
    return features


def run_rf_baseline(train: pd.DataFrame, test: pd.DataFrame, seed: int) -> tuple[RandomForestClassifier, dict]:
    x_train, y_train = _rf_features(train), train[TARGET_COL]
    x_test, y_test = _rf_features(test), test[TARGET_COL]
    x_test = x_test.reindex(columns=x_train.columns, fill_value=0)

    clf = RandomForestClassifier(n_estimators=300, class_weight="balanced", random_state=seed)
    clf.fit(x_train, y_train)
    preds = clf.predict(x_test)

    metrics = {
        "accuracy": float(accuracy_score(y_test, preds)),
        "macro_f1": float(f1_score(y_test, preds, average="macro", zero_division=0)),
    }
    return clf, metrics


def _parse_choice(text: str) -> int | None:
    text = text.strip().upper()
    mapping = {"A": 1, "B": 2, "C": 3}
    for letter, code in mapping.items():
        if text.startswith(letter):
            return code
    for code, label in TARGET_LABELS.items():
        if label.upper() in text:
            return code
    return None


def run_lm_predictions(sample: pd.DataFrame, model: str | None) -> list[int | None]:
    preds: list[int | None] = []
    for _, row in sample.iterrows():
        prompt = (
            f"{persona_text(row)}\n\n"
            f"Survey question: {TARGET_QUESTION}\n\n"
            "A) Favor\nB) Oppose\nC) Neither favor nor oppose\n\n"
            "Answer with ONLY the letter of your answer, nothing else."
        )
        reply = complete_chat([{"role": "user", "content": prompt}], model=model, temperature=1.0, max_tokens=5)
        preds.append(_parse_choice(reply))
    return preds


def run_retrodiction(
    test_size: float = TEST_SIZE,
    lm_sample_size: int = LM_EVAL_SAMPLE_SIZE,
    seed: int = SEED,
    model: str | None = None,
) -> dict:
    data = load_dataset()
    train, test = train_test_split(data, test_size=test_size, random_state=seed, stratify=data[TARGET_COL])

    rf_model, rf_metrics_full_test = run_rf_baseline(train, test, seed)

    lm_sample = test.sample(n=min(lm_sample_size, len(test)), random_state=seed)
    lm_preds = run_lm_predictions(lm_sample, model)

    valid_mask = [p is not None for p in lm_preds]
    n_unparsed = sum(1 for v in valid_mask if not v)
    lm_sample_valid = lm_sample[valid_mask]
    lm_preds_valid = [p for p, v in zip(lm_preds, valid_mask) if v]

    lm_metrics = {
        "accuracy": float(accuracy_score(lm_sample_valid[TARGET_COL], lm_preds_valid)) if lm_preds_valid else None,
        "macro_f1": float(f1_score(lm_sample_valid[TARGET_COL], lm_preds_valid, average="macro", labels=[1, 2, 3], zero_division=0))
        if lm_preds_valid
        else None,
        "n_unparsed": n_unparsed,
    }

    # RF evaluated on the exact same subset the LM was evaluated on, for a
    # fair head-to-head (not just "RF on its own bigger test set").
    rf_preds_on_lm_subset = rf_model.predict(_rf_features(lm_sample).reindex(columns=_rf_features(train).columns, fill_value=0))
    rf_metrics_same_subset = {
        "accuracy": float(accuracy_score(lm_sample[TARGET_COL], rf_preds_on_lm_subset)),
        "macro_f1": float(f1_score(lm_sample[TARGET_COL], rf_preds_on_lm_subset, average="macro", zero_division=0)),
    }

    real_dist = {TARGET_LABELS[k]: v for k, v in lm_sample[TARGET_COL].value_counts(normalize=True).items()}
    lm_pred_counts = pd.Series(lm_preds_valid).value_counts(normalize=True) if lm_preds_valid else pd.Series(dtype=float)
    lm_dist = {TARGET_LABELS[k]: v for k, v in lm_pred_counts.items()}
    rf_dist = {
        TARGET_LABELS[k]: v for k, v in pd.Series(rf_preds_on_lm_subset).value_counts(normalize=True).items()
    }

    return {
        "n_total_valid_respondents": len(data),
        "n_train": len(train),
        "n_test": len(test),
        "n_lm_eval_sample": len(lm_sample),
        "target_distribution_full_data": {TARGET_LABELS[k]: v for k, v in data[TARGET_COL].value_counts(normalize=True).items()},
        "rf_baseline_full_test_set": rf_metrics_full_test,
        "rf_baseline_on_lm_subset": rf_metrics_same_subset,
        "lm_zero_shot_on_same_subset": lm_metrics,
        "js_divergence_lm_vs_real": js_divergence(lm_dist, real_dist) if lm_dist else None,
        "js_divergence_rf_vs_real": js_divergence(rf_dist, real_dist),
        "real_distribution_on_subset": real_dist,
        "lm_predicted_distribution": lm_dist,
        "rf_predicted_distribution": rf_dist,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--test-size", type=float, default=TEST_SIZE)
    parser.add_argument("--lm-sample-size", type=int, default=LM_EVAL_SAMPLE_SIZE)
    parser.add_argument("--seed", type=int, default=SEED)
    parser.add_argument("--model", type=str, default=None)
    args = parser.parse_args()

    try:
        results = run_retrodiction(args.test_size, args.lm_sample_size, args.seed, args.model)
    except NoLLMBackendAvailable as exc:
        print(f"BLOCKED: {exc}")
        raise SystemExit(1)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUTPUT_DIR / "phase2_retrodiction_summary.json").write_text(json.dumps(results, indent=2))
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
