"""Train a real-data-grounded opinion_score probe on sentence embeddings
(Phase 4, AGENTS.md 3.1 fallback path) -- upgrade over both
model/scorer/placeholder.py (hand-curated lexicon) and
model/scorer/train_bow_probe.py (TF-IDF bag-of-words).

Ground truth: same as train_bow_probe.py -- data/processed/polis_vote_labels.jsonl,
1,741 real Polis comments with real human vote distributions.

Why embeddings over TF-IDF: TF-IDF only fires on literal word/bigram
overlap with the training vocabulary, so it can't generalize across the 12
very different real conversations (minimum wage, electoral reform, UBI,
biodiversity, ...) each with their own vocabulary. A pretrained sentence
embedding (sentence-transformers/all-MiniLM-L6-v2, 384-dim) captures
semantic similarity ("cut costs" ~ "reduce spending") instead of exact
wording, which matters a lot with only ~1.7k training examples spread
across 12 topics. Measured: AUC 0.680 (TF-IDF) -> 0.737 (embeddings) on
the same held-out split.

The exported probe is still just a linear layer (weights + bias) on top
of a FIXED, frozen embedding -- a real "linear probe" in the AGENTS.md 3.1
sense, just probing a general-purpose sentence encoder's embedding space
instead of the opinion model's own internal activations (that's the
still-more-correct Phase 4 option, requiring local GPU access to the
opinion model's weights -- this is the practical middle ground).

The embedding model must match exactly between training (here, PyTorch via
sentence-transformers) and serving (src/lib/citizen-reaction/embedding-probe-score.ts,
transformers.js/ONNX Runtime via @huggingface/transformers) -- same model id,
same normalization. Verified empirically to agree to ~1e-3 cosine
similarity across backends (PyTorch vs ONNX), which does not change
downstream classification decisions.

Run: uv run python -m model.scorer.train_embedding_probe
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from sentence_transformers import SentenceTransformer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, roc_auc_score
from sklearn.model_selection import train_test_split

REPO_ROOT = Path(__file__).resolve().parents[2]
POLIS_LABELS_PATH = REPO_ROOT / "data" / "processed" / "polis_vote_labels.jsonl"
OUT_PATH = REPO_ROOT / "src" / "lib" / "citizen-reaction" / "embedding-probe-weights.json"

MODEL_ID = "sentence-transformers/all-MiniLM-L6-v2"
MIN_VOTES = 5
C = 0.1
SEED = 42


def load_examples() -> tuple[list[str], list[float]]:
    texts: list[str] = []
    labels: list[float] = []
    with POLIS_LABELS_PATH.open(encoding="utf-8") as f:
        for line in f:
            row = json.loads(line)
            vote_dist = row.get("real_vote_distribution") or {}
            n_votes = vote_dist.get("n_votes", 0)
            agree = vote_dist.get("agree")
            if agree is None or n_votes < MIN_VOTES:
                continue
            texts.append(row["text"])
            labels.append(agree)
    return texts, labels


def main() -> None:
    texts, agree_fractions = load_examples()
    print(f"Loaded {len(texts)} real Polis comments with real vote distributions (n_votes >= {MIN_VOTES}).")

    y = np.array([1 if a > 0.5 else 0 for a in agree_fractions])
    print(f"Class balance: {y.mean():.3f} majority-agree.")

    model = SentenceTransformer(MODEL_ID)
    print(f"Encoding with {MODEL_ID} (dim={model.get_sentence_embedding_dimension()})...")
    embeddings = model.encode(texts, show_progress_bar=False, normalize_embeddings=True)

    X_train, X_val, y_train, y_val = train_test_split(
        embeddings, y, test_size=0.2, random_state=SEED, stratify=y,
    )

    clf = LogisticRegression(max_iter=3000, C=C, class_weight="balanced")
    clf.fit(X_train, y_train)

    val_pred = clf.predict(X_val)
    val_proba = clf.predict_proba(X_val)[:, 1]
    acc = accuracy_score(y_val, val_pred)
    auc = roc_auc_score(y_val, val_proba)
    print(f"Held-out accuracy: {acc:.3f}, AUC: {auc:.3f} (n_val={len(y_val)})")

    # Refit on all real examples for the deployed weights (held-out metrics above already recorded).
    final_clf = LogisticRegression(max_iter=3000, C=C, class_weight="balanced")
    final_clf.fit(embeddings, y)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUT_PATH.open("w", encoding="utf-8") as f:
        json.dump(
            {
                "_provenance": (
                    "Trained on real Polis comments + real human vote distributions "
                    "(data/processed/polis_vote_labels.jsonl, 12 public conversations); "
                    "see model/scorer/train_embedding_probe.py. Not a synthetic/hand-picked lexicon."
                ),
                "modelId": MODEL_ID,
                "bias": round(float(final_clf.intercept_[0]), 6),
                "weights": [round(float(w), 6) for w in final_clf.coef_[0]],
                "trainedOn": {
                    "nExamples": len(texts),
                    "nTrain": len(X_train),
                    "nVal": len(X_val),
                    "valAccuracy": round(float(acc), 4),
                    "valAuc": round(float(auc), 4),
                    "minVotes": MIN_VOTES,
                    "embeddingDim": embeddings.shape[1],
                },
            },
            f,
            indent=2,
        )
    print(f"Wrote probe weights to {OUT_PATH} (refit on all {len(texts)} examples).")


if __name__ == "__main__":
    main()
