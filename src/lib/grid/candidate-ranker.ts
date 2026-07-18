import type { ObjectiveWeights, RankedCandidate, SimulationResult } from "@/lib/grid/types";

export const DEFAULT_OBJECTIVE_WEIGHTS: ObjectiveWeights = {
  netValue: 0.5,
  renewableCapture: 0.2,
  carbonAvoided: 0.2,
  degradation: 0.1,
};

export interface RankableCandidate {
  candidateId: string;
  result: SimulationResult;
}

function normalizeGood(value: number, min: number, max: number): number {
  if (max - min < 1e-9) {
    return 1;
  }
  return (value - min) / (max - min);
}

function normalizeBad(value: number, min: number, max: number): number {
  if (max - min < 1e-9) {
    return 1;
  }
  return (max - value) / (max - min);
}

function errorCount(result: SimulationResult): number {
  return result.violations.filter((violation) => violation.severity === "error").length;
}

/**
 * Deterministic, locally computed ranking. Backboard never assigns this score;
 * it only ever sees the resulting rank and breakdown as evidence.
 */
export function rankCandidates(
  candidates: RankableCandidate[],
  weights: ObjectiveWeights = DEFAULT_OBJECTIVE_WEIGHTS,
): RankedCandidate[] {
  const valid = candidates.filter((candidate) => candidate.result.valid);
  const disqualified = candidates.filter((candidate) => !candidate.result.valid);

  const netValues = valid.map((c) => c.result.metrics.netValueCad);
  const renewableValues = valid.map((c) => c.result.metrics.renewableCapturedMwh);
  const carbonValues = valid.map((c) => c.result.metrics.carbonAvoidedKg);
  const degradationValues = valid.map((c) => c.result.metrics.degradationCostCad);

  const netMin = Math.min(...netValues, 0);
  const netMax = Math.max(...netValues, 0);
  const renewableMin = Math.min(...renewableValues, 0);
  const renewableMax = Math.max(...renewableValues, 0);
  const carbonMin = Math.min(...carbonValues, 0);
  const carbonMax = Math.max(...carbonValues, 0);
  const degradationMin = Math.min(...degradationValues, 0);
  const degradationMax = Math.max(...degradationValues, 0);

  const scoredValid: RankedCandidate[] = valid
    .map((candidate) => {
      const { metrics } = candidate.result;
      const breakdown = {
        netValue: normalizeGood(metrics.netValueCad, netMin, netMax) * weights.netValue,
        renewableCapture:
          normalizeGood(metrics.renewableCapturedMwh, renewableMin, renewableMax) *
          weights.renewableCapture,
        carbonAvoided:
          normalizeGood(metrics.carbonAvoidedKg, carbonMin, carbonMax) * weights.carbonAvoided,
        degradation:
          normalizeBad(metrics.degradationCostCad, degradationMin, degradationMax) *
          weights.degradation,
      };
      const score = breakdown.netValue + breakdown.renewableCapture + breakdown.carbonAvoided + breakdown.degradation;
      return {
        candidateId: candidate.candidateId,
        rank: 0,
        score,
        disqualified: false,
        violationCount: errorCount(candidate.result),
        breakdown,
      };
    })
    .sort((a, b) => b.score - a.score)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));

  const zeroBreakdown: RankedCandidate["breakdown"] = {
    netValue: 0,
    renewableCapture: 0,
    carbonAvoided: 0,
    degradation: 0,
  };

  const scoredDisqualified: RankedCandidate[] = disqualified
    .slice()
    .sort((a, b) => errorCount(a.result) - errorCount(b.result))
    .map((candidate, index) => {
      const firstError = candidate.result.violations.find((v) => v.severity === "error");
      return {
        candidateId: candidate.candidateId,
        rank: scoredValid.length + index + 1,
        score: Number.NEGATIVE_INFINITY,
        disqualified: true,
        disqualifyReason: firstError?.message ?? "Plan failed deterministic validation.",
        violationCount: errorCount(candidate.result),
        breakdown: zeroBreakdown,
      };
    });

  return [...scoredValid, ...scoredDisqualified];
}
