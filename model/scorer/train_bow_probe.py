"""Train a real-data-grounded opinion_score probe (Phase 4, AGENTS.md 3.1 fallback path).

Ground truth: `data/processed/sft_polis_rows.jsonl`'s `metadata.real_vote_distribution`
-- the actual fraction of real human Polis participants who voted agree/disagree/pass
on that exact comment. No synthetic labels: every training example is a real
comment paired with a real human vote outcome.

This replaces the hand-curated lexicon in `model/scorer/placeholder.py` with a
bag-of-words logistic regression: a bounded vocabulary of (word -> learned
coefficient) plus a bias, exported to JSON so the TS-side scorer can compute
sigmoid(dot(counts, weights) + bias) with no ML runtime dependency -- same
"read only the opinion text" invariant as the placeholder (AGENTS.md 3.1), just
with weights learned from real votes instead of picked by hand.

Run: uv run python -m model.scorer.train_bow_probe
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import numpy as np
from sklearn.feature_extraction.text import CountVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, roc_auc_score
from sklearn.model_selection import train_test_split

REPO_ROOT = Path(__file__).resolve().parents[2]
POLIS_ROWS_PATH = REPO_ROOT / "data" / "processed" / "sft_polis_rows.jsonl"
OUT_PATH = REPO_ROOT / "src" / "lib" / "citizen-reaction" / "bow-probe-weights.json"

MIN_VOTES = 5  # drop comments with too few real votes to trust the label
MAX_VOCAB = 2000
SEED = 42


def load_examples() -> tuple[list[str], list[float]]:
    texts: list[str] = []
    labels: list[float] = []
    with POLIS_ROWS_PATH.open(encoding="utf-8") as f:
        for line in f:
            row = json.loads(line)
            vote_dist = row.get("metadata", {}).get("real_vote_distribution") or {}
            n_votes = vote_dist.get("n_votes", 0)
            agree = vote_dist.get("agree")
            if agree is None or n_votes < MIN_VOTES:
                continue
            texts.append(row["output"])
            labels.append(agree)
    return texts, labels


def main() -> None:
    texts, agree_fractions = load_examples()
    print(f"Loaded {len(texts)} real Polis comments with real vote distributions (n_votes >= {MIN_VOTES}).")

    # Binary target: did most real voters agree? Mirrors opinion_score's
    # 0.5-is-neutral semantics -- predict_proba gives a continuous [0,1] readout.
    y = np.array([1 if a > 0.5 else 0 for a in agree_fractions])
    print(f"Class balance: {y.mean():.3f} majority-agree.")

    X_train_text, X_val_text, y_train, y_val = train_test_split(
        texts, y, test_size=0.2, random_state=SEED, stratify=y,
    )

    vectorizer = CountVectorizer(
        max_features=MAX_VOCAB,
        min_df=2,
        stop_words="english",
        token_pattern=r"[a-zA-Z']+",
        lowercase=True,
    )
    X_train = vectorizer.fit_transform(X_train_text)
    X_val = vectorizer.transform(X_val_text)

    clf = LogisticRegression(max_iter=2000, C=1.0, class_weight="balanced")
    clf.fit(X_train, y_train)

    val_pred = clf.predict(X_val)
    val_proba = clf.predict_proba(X_val)[:, 1]
    acc = accuracy_score(y_val, val_pred)
    auc = roc_auc_score(y_val, val_proba) if len(set(y_val)) > 1 else float("nan")
    print(f"Held-out accuracy: {acc:.3f}, AUC: {auc:.3f} (n_val={len(y_val)})")

    vocabulary = vectorizer.get_feature_names_out()
    coefficients = clf.coef_[0]
    weights = {word: round(float(coef), 6) for word, coef in zip(vocabulary, coefficients)}

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUT_PATH.open("w", encoding="utf-8") as f:
        json.dump(
            {
                "_provenance": (
                    "Trained on real Polis comments + real human vote distributions "
                    "(data/processed/sft_polis_rows.jsonl); see model/scorer/train_bow_probe.py. "
                    "Not a synthetic/hand-picked lexicon."
                ),
                "bias": round(float(clf.intercept_[0]), 6),
                "weights": weights,
                "trainedOn": {
                    "nExamples": len(texts),
                    "nTrain": len(X_train_text),
                    "nVal": len(X_val_text),
                    "valAccuracy": round(float(acc), 4),
                    "valAuc": round(float(auc), 4) if auc == auc else None,
                    "minVotes": MIN_VOTES,
                    "vocabSize": len(vocabulary),
                },
            },
            f,
            indent=2,
        )
    print(f"Wrote probe weights to {OUT_PATH}")


if __name__ == "__main__":
    main()
