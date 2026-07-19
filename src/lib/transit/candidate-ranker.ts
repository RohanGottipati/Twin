import type { PolicyCandidate, TransitIntervention, TransitSimulationResult } from "@/lib/transit/schemas";

/**
 * Deterministic, locally computed ranking of candidate interventions
 * (docs/techto-implementation.md section 12.4 reward weighting, adapted to
 * the metrics this simulator actually produces). Backboard never assigns
 * this score; it only ever sees the resulting rank and breakdown as
 * evidence, consistent with AGENTS.md 3.2 (the scorer is never co-adapted
 * with whatever generated the candidate).
 */

export interface TransitObjectiveWeights {
  wait: number;
  crowding: number;
  reliability: number;
  equity: number;
  carbon: number;
  operatingCost: number;
}

export const DEFAULT_TRANSIT_OBJECTIVE_WEIGHTS: TransitObjectiveWeights = {
  wait: 0.3,
  crowding: 0.2,
  reliability: 0.15,
  equity: 0.15,
  carbon: 0.1,
  operatingCost: 0.1,
};

export interface RankableIntervention {
  intervention: TransitIntervention;
  result: TransitSimulationResult;
}

/** Sentinel score for disqualified candidates. Finite (unlike -Infinity) so it satisfies the strict PolicyCandidate schema. */
const DISQUALIFIED_SCORE = -1_000_000;

function normalizeBad(value: number, min: number, max: number): number {
  if (max - min < 1e-9) return 1;
  return (max - value) / (max - min);
}

function errorCount(result: TransitSimulationResult): number {
  return result.violations.filter((violation) => violation.severity === "error").length;
}

function waitScore(candidate: RankableIntervention): number {
  return candidate.result.metrics.meanWaitMinutes * 0.6 + candidate.result.metrics.p90WaitMinutes * 0.4;
}

function crowdingScore(candidate: RankableIntervention): number {
  return candidate.result.metrics.loadImbalance * 0.5 + candidate.result.metrics.deniedBoardings * 0.5;
}

function reliabilityScore(candidate: RankableIntervention): number {
  return candidate.result.metrics.missedTransfers;
}

function equityScore(candidate: RankableIntervention): number {
  return candidate.result.metrics.equityGap * 0.5 + candidate.result.metrics.accessibilityFailures * 0.5;
}

function carbonScore(candidate: RankableIntervention): number {
  return candidate.result.metrics.estimatedCarbonKg;
}

function operatingCostScore(candidate: RankableIntervention): number {
  return candidate.result.metrics.operatingCostScore;
}

function range(values: number[]): { min: number; max: number } {
  return { min: Math.min(...values, 0), max: Math.max(...values, 0) };
}

export function rankInterventions(
  candidates: RankableIntervention[],
  weights: TransitObjectiveWeights = DEFAULT_TRANSIT_OBJECTIVE_WEIGHTS,
): PolicyCandidate[] {
  const valid = candidates.filter((candidate) => candidate.result.valid);
  const disqualified = candidates.filter((candidate) => !candidate.result.valid);

  const waitRange = range(valid.map(waitScore));
  const crowdingRange = range(valid.map(crowdingScore));
  const reliabilityRange = range(valid.map(reliabilityScore));
  const equityRange = range(valid.map(equityScore));
  const carbonRange = range(valid.map(carbonScore));
  const operatingCostRange = range(valid.map(operatingCostScore));

  const scoredValid: PolicyCandidate[] = valid
    .map((candidate) => {
      const breakdown = {
        wait: normalizeBad(waitScore(candidate), waitRange.min, waitRange.max) * weights.wait,
        crowding: normalizeBad(crowdingScore(candidate), crowdingRange.min, crowdingRange.max) * weights.crowding,
        reliability:
          normalizeBad(reliabilityScore(candidate), reliabilityRange.min, reliabilityRange.max) * weights.reliability,
        equity: normalizeBad(equityScore(candidate), equityRange.min, equityRange.max) * weights.equity,
        carbon: normalizeBad(carbonScore(candidate), carbonRange.min, carbonRange.max) * weights.carbon,
        operatingCost:
          normalizeBad(operatingCostScore(candidate), operatingCostRange.min, operatingCostRange.max) *
          weights.operatingCost,
      };
      const score = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
      return {
        candidateId: `${candidate.intervention.id}-candidate`,
        interventionId: candidate.intervention.id,
        label: candidate.intervention.label,
        rank: 0,
        score,
        disqualified: false,
        violationCount: errorCount(candidate.result),
        breakdown,
        metrics: candidate.result.metrics,
        dataMode: "synthetic-fixture" as const,
      };
    })
    .sort((a, b) => b.score - a.score)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));

  const zeroBreakdown = {
    wait: 0,
    crowding: 0,
    reliability: 0,
    equity: 0,
    carbon: 0,
    operatingCost: 0,
  };

  const scoredDisqualified: PolicyCandidate[] = disqualified
    .slice()
    .sort((a, b) => errorCount(a.result) - errorCount(b.result))
    .map((candidate, index) => {
      const firstError = candidate.result.violations.find((violation) => violation.severity === "error");
      return {
        candidateId: `${candidate.intervention.id}-candidate`,
        interventionId: candidate.intervention.id,
        label: candidate.intervention.label,
        rank: scoredValid.length + index + 1,
        score: DISQUALIFIED_SCORE,
        disqualified: true,
        disqualifyReason: firstError?.message ?? "Intervention failed deterministic validation.",
        violationCount: errorCount(candidate.result),
        breakdown: zeroBreakdown,
        metrics: candidate.result.metrics,
        dataMode: "synthetic-fixture" as const,
      };
    });

  return [...scoredValid, ...scoredDisqualified];
}
