import weightsData from "@/lib/citizen-reaction/bow-probe-weights.json";

/**
 * Real-data-grounded opinion_score probe: TF-IDF (unigrams + bigrams) +
 * logistic regression, trained on 1,741 real Polis comments against real
 * human vote distributions (model/scorer/train_bow_probe.py). Reproduces
 * sklearn's TfidfVectorizer(norm="l2") + LogisticRegression scoring exactly
 * so this file needs no ML runtime dependency at request time.
 *
 * Beats the hand-curated lexicon (model/scorer/placeholder.py, TS port in
 * opinion-score.ts) on held-out real data: AUC 0.680 vs 0.524 (near-chance).
 * Still reads only the opinion text, never the persona/policy (AGENTS.md 3.1).
 */

interface Term {
  weight: number;
  idf: number;
}

interface ProbeWeights {
  bias: number;
  terms: Record<string, Term>;
  norm: "l2";
  ngramRange: [number, number];
  trainedOn: { nExamples: number; valAccuracy: number; valAuc: number | null };
}

const weights = weightsData as unknown as ProbeWeights;

const TOKEN_RE = /[a-zA-Z']+/g;

function tokenize(text: string): string[] {
  return (text.match(TOKEN_RE) ?? []).map((w) => w.toLowerCase());
}

function ngrams(tokens: string[], n: number): string[] {
  if (n === 1) return tokens;
  const grams: string[] = [];
  for (let i = 0; i + n <= tokens.length; i++) {
    grams.push(tokens.slice(i, i + n).join(" "));
  }
  return grams;
}

/** Mirrors sklearn TfidfVectorizer(ngram_range, norm="l2").transform() for a single document. */
export function scoreOpinionWithProbe(opinionText: string): number {
  const tokens = tokenize(opinionText);
  if (tokens.length === 0) return 0.5;

  const [minN, maxN] = weights.ngramRange;
  const termCounts = new Map<string, number>();
  for (let n = minN; n <= maxN; n++) {
    for (const gram of ngrams(tokens, n)) {
      if (weights.terms[gram]) {
        termCounts.set(gram, (termCounts.get(gram) ?? 0) + 1);
      }
    }
  }

  if (termCounts.size === 0) return 0.5;

  // tf-idf per matched term, then L2-normalize across the document's vector.
  const tfidf = new Map<string, number>();
  let sumSquares = 0;
  for (const [term, count] of termCounts) {
    const value = count * weights.terms[term].idf;
    tfidf.set(term, value);
    sumSquares += value * value;
  }
  const norm = Math.sqrt(sumSquares) || 1;

  let dot = weights.bias;
  for (const [term, value] of tfidf) {
    dot += (value / norm) * weights.terms[term].weight;
  }

  return 1 / (1 + Math.exp(-dot));
}

export function probeMetadata() {
  return weights.trainedOn;
}
