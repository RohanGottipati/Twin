"""Placeholder valence scorer for Phase 1 (implementation_plan.md: "score
with a placeholder sentiment probe").

This is explicitly NOT the frozen linear probe over model activations that
AGENTS.md 3.1 mandates as the real scorer ("Prefer a frozen linear probe
over activations to a text sentiment model, because activations reflect the
model's actual state rather than its rhetoric"). Training that probe needs
labelled human opinion data and comes in Phase 4
(`model/scorer/` -- "Train the frozen valence probe on human opinion ->
valence"). Until then, this lexicon scorer is a deliberately simple stand-in
so the Phase 1 loop (opinion -> valence -> heatmap) can be exercised end to
end.

It still respects the one invariant that matters even for a placeholder
(AGENTS.md 3.1): it reads ONLY the generated opinion text, never the raw
persona profile or the policy description directly. That's enforced by the
function signature below -- `score_opinion(text: str)` structurally cannot
see anything else.
"""

from __future__ import annotations

import re

# Small, hand-curated lexicon for city-policy opinion text. Not tuned or
# validated against any dataset -- a placeholder, not a scorer whose weights
# should be trusted for anything beyond the Phase 1 sanity loop.
POSITIVE_WORDS = {
    "great", "good", "love", "excellent", "support", "welcome", "helpful",
    "convenient", "excited", "glad", "happy", "improve", "improves",
    "improved", "improvement", "beneficial", "positive", "appreciate",
    "fantastic", "wonderful", "better", "easier", "accessible", "pleased",
    "favor", "favour", "like", "praise", "boost", "thrilled", "yes",
}
NEGATIVE_WORDS = {
    "bad", "hate", "terrible", "oppose", "opposed", "against", "worried",
    "concern", "concerned", "concerns", "angry", "upset", "unfair",
    "expensive", "costly", "burden", "worse", "harder", "inconvenient",
    "negative", "disappointed", "frustrated", "annoyed", "no", "reject",
    "unnecessary", "waste", "hurt", "hurts", "disruption", "disruptive",
    "loss", "lose", "traffic", "noisy", "noise", "congestion",
}

NEGATORS = {"not", "no", "n't", "won't", "don't", "doesn't", "isn't", "didn't", "wouldn't", "shouldn't", "never", "hardly", "barely"}
# How many tokens back a negator can reach and still flip the sentiment
# word's polarity (a generic negation-scope heuristic, not tuned to any
# particular model's phrasing -- "won't make much of a difference",
# "doesn't really help", "not going to cut it" are all common enough
# constructions in everyday English opinion text that a fixed-size negation
# window is a standard, unremarkable placeholder-scorer technique, not an
# overfit to one run's output).
NEGATION_WINDOW = 3

_WORD_RE = re.compile(r"[a-zA-Z']+")


def score_opinion(opinion_text: str) -> float:
    """Return a valence in [0, 1]; 0.5 is neutral / no signal.

    Reads only `opinion_text` -- see module docstring. Includes a simple
    negation-scope flip (a sentiment word preceded within NEGATION_WINDOW
    tokens by a negator has its polarity inverted), since plain
    bag-of-words scoring badly misreads common hedged phrasing like "won't
    make much of a difference for me" as neutral-to-positive.
    """
    words = [w.lower() for w in _WORD_RE.findall(opinion_text)]
    if not words:
        return 0.5

    pos = 0.0
    neg = 0.0
    for i, w in enumerate(words):
        if w not in POSITIVE_WORDS and w not in NEGATIVE_WORDS:
            continue
        window = words[max(0, i - NEGATION_WINDOW) : i]
        negated = any(t in NEGATORS or t.endswith("n't") for t in window)
        is_positive = w in POSITIVE_WORDS
        if negated:
            is_positive = not is_positive
        if is_positive:
            pos += 1
        else:
            neg += 1

    if pos == 0 and neg == 0:
        return 0.5
    # Bounded, monotonic in (pos - neg); saturates gracefully rather than
    # needing an arbitrary cutoff.
    net = pos - neg
    return 0.5 + 0.5 * (net / (abs(net) + 3))
