/**
 * Placeholder opinion_score scorer for Phase 1 (mirrors `model/scorer/placeholder.py`
 * exactly -- same lexicon, same negation-scope heuristic, same output formula).
 *
 * This is explicitly NOT the frozen linear probe over model activations that
 * AGENTS.md 3.1 mandates as the real scorer. Training that probe needs
 * labelled human opinion data (Phase 4, `model/scorer/`). Until then, this
 * lexicon scorer is a deliberately simple stand-in so the citizen-reaction
 * loop (opinion -> opinion_score -> acceptance) can run end to end on real
 * generated opinion text.
 *
 * Keep in sync with `model/scorer/placeholder.py` -- if that file's word
 * lists or formula change, mirror the change here too.
 *
 * It still respects the one invariant that matters even for a placeholder
 * (AGENTS.md 3.1): it reads ONLY the generated opinion text, never the raw
 * persona profile or the policy description directly -- enforced by the
 * function signature (`scoreOpinion(text: string)` structurally cannot see
 * anything else).
 */

const POSITIVE_WORDS = new Set([
  "great", "good", "love", "excellent", "support", "welcome", "helpful",
  "convenient", "excited", "glad", "happy", "improve", "improves",
  "improved", "improvement", "beneficial", "positive", "appreciate",
  "fantastic", "wonderful", "better", "easier", "accessible", "pleased",
  "favor", "favour", "like", "praise", "boost", "thrilled", "yes",
]);

const NEGATIVE_WORDS = new Set([
  "bad", "hate", "terrible", "oppose", "opposed", "against", "worried",
  "concern", "concerned", "concerns", "angry", "upset", "unfair",
  "expensive", "costly", "burden", "worse", "harder", "inconvenient",
  "negative", "disappointed", "frustrated", "annoyed", "no", "reject",
  "unnecessary", "waste", "hurt", "hurts", "disruption", "disruptive",
  "loss", "lose", "traffic", "noisy", "noise", "congestion",
]);

const NEGATORS = new Set([
  "not", "no", "n't", "won't", "don't", "doesn't", "isn't", "didn't",
  "wouldn't", "shouldn't", "never", "hardly", "barely",
]);

/** How many tokens back a negator can reach and still flip the sentiment word's polarity. */
const NEGATION_WINDOW = 3;

const WORD_RE = /[a-zA-Z']+/g;

/**
 * Return an opinion_score in [0, 1]; 0.5 is neutral / no signal.
 *
 * Reads only `opinionText` -- see module docstring. Includes a simple
 * negation-scope flip since plain bag-of-words scoring badly misreads
 * hedged phrasing like "won't make much of a difference for me".
 */
export function scoreOpinion(opinionText: string): number {
  const words = (opinionText.match(WORD_RE) ?? []).map((w) => w.toLowerCase());
  if (words.length === 0) return 0.5;

  let pos = 0;
  let neg = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!POSITIVE_WORDS.has(w) && !NEGATIVE_WORDS.has(w)) continue;

    const window = words.slice(Math.max(0, i - NEGATION_WINDOW), i);
    const negated = window.some((t) => NEGATORS.has(t) || t.endsWith("n't"));
    let isPositive = POSITIVE_WORDS.has(w);
    if (negated) isPositive = !isPositive;

    if (isPositive) pos += 1;
    else neg += 1;
  }

  if (pos === 0 && neg === 0) return 0.5;
  const net = pos - neg;
  return 0.5 + 0.5 * (net / (Math.abs(net) + 3));
}
