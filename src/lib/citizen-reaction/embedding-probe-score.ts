import weightsData from "@/lib/citizen-reaction/embedding-probe-weights.json";

/**
 * Real-data-grounded opinion_score probe, v2: a linear layer on top of a
 * frozen pretrained sentence embedding (sentence-transformers/all-MiniLM-L6-v2,
 * 384-dim), trained on 1,741 real Polis comments against real human vote
 * distributions (model/scorer/train_embedding_probe.py). A "linear probe"
 * in the AGENTS.md 3.1 sense -- just probing a general-purpose sentence
 * encoder's embedding space, not the opinion model's own internal
 * activations (that would need local GPU access to the opinion model's
 * weights; this is the practical middle ground).
 *
 * Beats the TF-IDF probe (bow-probe-score.ts) on the same held-out real
 * data: AUC 0.737 vs 0.680. Embeddings capture semantic similarity
 * ("cut costs" ~ "reduce spending") instead of literal word overlap,
 * which matters when training data spans many different real topics.
 *
 * Uses the same model id, loaded via transformers.js (ONNX Runtime), as
 * training used via sentence-transformers (PyTorch) -- verified to agree
 * to ~1e-3 cosine similarity across backends, which does not change
 * downstream classification decisions.
 */

interface EmbeddingProbeWeights {
  modelId: string;
  bias: number;
  weights: number[];
  trainedOn: { nExamples: number; valAccuracy: number; valAuc: number; embeddingDim: number };
}

const weights = weightsData as unknown as EmbeddingProbeWeights;

let extractorPromise: Promise<unknown> | null = null;

async function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const { pipeline } = await import("@huggingface/transformers");
      return pipeline("feature-extraction", weights.modelId);
    })();
  }
  return extractorPromise;
}

/** Mirrors sentence_transformers' encode(..., normalize_embeddings=True) with mean pooling. */
export async function scoreOpinionWithEmbeddingProbe(opinionText: string): Promise<number> {
  const text = opinionText.trim();
  if (!text) return 0.5;

  const extractor = (await getExtractor()) as (
    text: string,
    options: { pooling: "mean"; normalize: boolean },
  ) => Promise<{ data: Float32Array | number[] }>;

  const output = await extractor(text, { pooling: "mean", normalize: true });
  const embedding = Array.from(output.data as ArrayLike<number>);

  let dot = weights.bias;
  for (let i = 0; i < embedding.length; i++) {
    dot += embedding[i] * weights.weights[i];
  }
  return 1 / (1 + Math.exp(-dot));
}

export function embeddingProbeMetadata() {
  return weights.trainedOn;
}
