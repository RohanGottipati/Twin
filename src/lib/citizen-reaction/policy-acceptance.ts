import { getMongoDb } from "@/lib/mongodb/client";
import { COLLECTIONS } from "@/lib/mongodb/collections";
import { getOrGenerateOpinion } from "@/lib/citizen-reaction/opinion-cache";
import { scoreOpinionWithEmbeddingProbe } from "@/lib/citizen-reaction/embedding-probe-score";
import { runWithLimit } from "@/lib/citizen-reaction/concurrency";
import type { ScenarioPatch } from "@/lib/planner/scenario";

const BATCH_SIZE = Number(process.env.TECHTO_POLICY_BATCH_SIZE ?? 12);
const MAX_SAMPLE_SIZE = Number(process.env.TECHTO_POLICY_MAX_SAMPLE_SIZE ?? 60);
const CONCURRENCY = Number(process.env.TECHTO_OPINION_CONCURRENCY ?? 8);
/** Stop once the 95% CI half-width on the mean acceptance is at or below this (acceptance is in [0, 1]). */
const CI_HALF_WIDTH_TARGET = Number(process.env.TECHTO_POLICY_CI_TARGET ?? 0.08);
/** Never stop before this many real residents, so an early lucky/unlucky batch can't look falsely confident. */
const MIN_SAMPLE_SIZE = Number(process.env.TECHTO_POLICY_MIN_SAMPLE_SIZE ?? BATCH_SIZE);

export interface PolicyAcceptanceResult {
  scenarioId: string;
  provider: "real-opinion-model";
  citywide: {
    mean: number;
    supportShare: number;
    opposeShare: number;
    sampleSize: number;
    /** Half-width of the 95% confidence interval on `mean` (mean ± this). Smaller = more confident. */
    ciHalfWidth: number;
    /** Why sampling stopped: hit the statistical confidence target, hit the hard sample cap, or ran out of real residents to sample (e.g. a small neighbourhood filter). */
    stopReason: "confident" | "max-sample" | "pool-exhausted";
  };
  byNeighbourhood: Record<string, { mean: number; count: number }>;
}

interface ResidentPersonaDoc {
  persona_id: string;
  neighbourhood_code: string;
  text: string;
}

export interface ScorePolicyOptions {
  /**
   * Restrict sampling to these neighbourhood codes instead of citywide --
   * e.g. when comparing a small number of candidate sites, there's no need
   * to spend real model calls on neighbourhoods nobody proposed anything
   * for. Omit for a citywide read.
   */
  neighbourhoodCodes?: string[];
  onPersonaScored?: (result: { personaId: string; code: string; acceptance: number; opinionText: string }) => void;
}

/** Same rendering convention as neighbourhood-acceptance.ts's scenarioPolicyText, for an open-city ScenarioPatch. */
export function policyTextForPatch(patch: ScenarioPatch): string {
  return `${patch.title}. ${patch.rationale}`;
}

function confidenceInterval(values: number[]): { mean: number; ciHalfWidth: number } {
  const n = values.length;
  if (n === 0) return { mean: 0.5, ciHalfWidth: 1 };
  const mean = values.reduce((sum, v) => sum + v, 0) / n;
  if (n === 1) return { mean, ciHalfWidth: 1 };
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (n - 1);
  const standardError = Math.sqrt(variance / n);
  return { mean, ciHalfWidth: 1.96 * standardError };
}

/**
 * Real acceptance for an arbitrary proposed policy, sequentially
 * Monte-Carlo-sampled from real residents (optionally restricted to a
 * caller-supplied set of neighbourhoods to save compute) and scored by the
 * real trained opinion model and the real-vote-trained embedding probe --
 * the same model, cache, and scorer used everywhere else in the app.
 *
 * Sampling is adaptive rather than a fixed N: it draws real residents in
 * small batches and keeps going only while the 95% confidence interval on
 * the mean acceptance is still too wide to trust, stopping as soon as it's
 * tight enough (or a hard cap / the real resident pool itself is reached)
 * -- a principled stopping rule instead of guessing a sample size upfront.
 */
export async function scoreRealPolicyAcceptance(
  scenarioId: string,
  policyText: string,
  options: ScorePolicyOptions = {},
): Promise<PolicyAcceptanceResult> {
  const { neighbourhoodCodes, onPersonaScored } = options;
  const db = await getMongoDb();
  const match = neighbourhoodCodes?.length ? { neighbourhood_code: { $in: neighbourhoodCodes } } : {};
  const pool = (await db
    .collection(COLLECTIONS.residentPersonas)
    .aggregate([
      { $match: match },
      { $sample: { size: MAX_SAMPLE_SIZE } },
      { $project: { persona_id: 1, neighbourhood_code: 1, text: 1, _id: 0 } },
    ])
    .toArray()) as unknown as ResidentPersonaDoc[];

  const scored: Array<{ code: string; acceptance: number }> = [];
  let stopReason: "confident" | "max-sample" | "pool-exhausted" = "pool-exhausted";

  for (let start = 0; start < pool.length; start += BATCH_SIZE) {
    const batch = pool.slice(start, start + BATCH_SIZE);
    const batchScored = await runWithLimit(
      batch.map((persona) => async () => {
        const opinionText = await getOrGenerateOpinion(persona.persona_id, persona.text, policyText);
        const acceptance = await scoreOpinionWithEmbeddingProbe(opinionText);
        onPersonaScored?.({ personaId: persona.persona_id, code: persona.neighbourhood_code, acceptance, opinionText });
        return { code: persona.neighbourhood_code, acceptance };
      }),
      CONCURRENCY,
    );
    scored.push(...batchScored);

    const { ciHalfWidth } = confidenceInterval(scored.map((s) => s.acceptance));
    if (scored.length >= MAX_SAMPLE_SIZE) {
      stopReason = "max-sample";
      break;
    }
    if (scored.length >= MIN_SAMPLE_SIZE && ciHalfWidth <= CI_HALF_WIDTH_TARGET) {
      stopReason = "confident";
      break;
    }
  }

  const n = scored.length;
  const { mean, ciHalfWidth } = confidenceInterval(scored.map((s) => s.acceptance));
  const supportShare = n ? scored.filter((s) => s.acceptance >= 0.6).length / n : 0;
  const opposeShare = n ? scored.filter((s) => s.acceptance <= 0.4).length / n : 0;

  const grouped = new Map<string, number[]>();
  for (const s of scored) {
    const list = grouped.get(s.code) ?? [];
    list.push(s.acceptance);
    grouped.set(s.code, list);
  }
  const byNeighbourhood: Record<string, { mean: number; count: number }> = {};
  for (const [code, values] of grouped) {
    byNeighbourhood[code] = {
      mean: values.reduce((a, b) => a + b, 0) / values.length,
      count: values.length,
    };
  }

  return {
    scenarioId,
    provider: "real-opinion-model",
    citywide: { mean, supportShare, opposeShare, sampleSize: n, ciHalfWidth, stopReason },
    byNeighbourhood,
  };
}
