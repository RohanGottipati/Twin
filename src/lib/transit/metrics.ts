import type { TransitCohortFixture } from "@/data/transit/cohorts";

/**
 * Metric helpers for the transit simulator: wait-time statistics, load
 * imbalance, the equity gap, and the carbon estimate. Every function here
 * is pure arithmetic over its inputs, so results are fully reproducible
 * given the same simulation trace.
 */

export interface WeightedSample {
  value: number;
  weight: number;
}

export function totalWeight(samples: WeightedSample[]): number {
  return samples.reduce((sum, sample) => sum + sample.weight, 0);
}

export function weightedMean(samples: WeightedSample[]): number {
  const weight = totalWeight(samples);
  if (weight <= 0) return 0;
  const weightedSum = samples.reduce((sum, sample) => sum + sample.value * sample.weight, 0);
  return weightedSum / weight;
}

/**
 * Weighted percentile using the "next value at or past the target
 * cumulative weight" rule: simple, deterministic, and exact for integer
 * rider counts, which is all this simulator ever produces.
 */
export function weightedPercentile(samples: WeightedSample[], percentile: number): number {
  const weight = totalWeight(samples);
  if (weight <= 0) return 0;

  const sorted = [...samples].sort((a, b) => a.value - b.value);
  const targetWeight = (percentile / 100) * weight;

  let cumulative = 0;
  for (const sample of sorted) {
    cumulative += sample.weight;
    if (cumulative >= targetWeight) {
      return sample.value;
    }
  }
  return sorted[sorted.length - 1].value;
}

export function meanWaitMinutes(waitSamples: WeightedSample[]): number {
  return weightedMean(waitSamples);
}

export function p90WaitMinutes(waitSamples: WeightedSample[]): number {
  return weightedPercentile(waitSamples, 90);
}

/**
 * The spread between the most and least loaded departure in a run, the
 * simplest legible readout of "did this schedule balance load across
 * departures". Zero or one departure has no imbalance to measure.
 */
export function computeLoadImbalance(loadFactors: number[]): number {
  if (loadFactors.length < 2) return 0;
  return Math.max(...loadFactors) - Math.min(...loadFactors);
}

interface CohortLike {
  weight: number;
  sensitivity: { waitSensitivity: number };
}

/**
 * A cohort-weighted proxy for "effective wait", not a per-cohort queue
 * simulation. Riders with higher wait sensitivity experience the same
 * clock-time wait as functionally worse, because missed connections and
 * schedule conflicts compound for them; this scales the shared clock-time
 * wait by (1 + waitSensitivity) and averages by cohort weight. Documented
 * assumption, not a fitted behavioral model (AGENTS.md section 2).
 */
export function computeCohortWeightedWaitMinutes(baseWaitMinutes: number, cohorts: CohortLike[]): number {
  const weight = cohorts.reduce((sum, cohort) => sum + cohort.weight, 0);
  if (weight <= 0) return baseWaitMinutes;
  const weightedSum = cohorts.reduce(
    (sum, cohort) => sum + cohort.weight * baseWaitMinutes * (1 + cohort.sensitivity.waitSensitivity),
    0,
  );
  return weightedSum / weight;
}

/**
 * The gap between the cohort-weighted wait experienced by vulnerable
 * riders (mobility-device users, low-income transit-dependent riders,
 * seniors; see data/transit/cohorts.ts vulnerableCohorts) and the same
 * measure across the full population. Zero means the schedule change
 * burdens vulnerable riders no more than everyone else; positive means it
 * burdens them more.
 */
export function computeEquityGap(
  baseWaitMinutes: number,
  vulnerable: TransitCohortFixture[],
  allCohorts: TransitCohortFixture[],
): number {
  const vulnerableWait = computeCohortWeightedWaitMinutes(baseWaitMinutes, vulnerable);
  const populationWait = computeCohortWeightedWaitMinutes(baseWaitMinutes, allCohorts);
  return Math.max(0, vulnerableWait - populationWait);
}

/**
 * Synthetic assumption: an average downtown Toronto car trip of roughly 8
 * kilometres at roughly 0.29 kg CO2 per kilometre for a typical passenger
 * vehicle, rounded. Not a measured emissions factor; see
 * docs/twinto-implementation.md section 11.7 ("do not claim exact marginal
 * emissions").
 */
export const AVERAGE_CAR_TRIP_CARBON_KG = 2.3;

/**
 * Only riders with plausible car access are assumed capable of switching
 * mode when denied boarding; `carSwitchProbability` should be the
 * cohort-weighted average `vehicleAccessProbability` across the affected
 * population (see lib/transit/simulator.ts).
 */
export function estimateCarTripsFromDeniedBoardings(deniedBoardings: number, carSwitchProbability: number): number {
  return Math.max(0, Math.round(deniedBoardings * carSwitchProbability));
}

export function estimateCarbonKg(carTrips: number): number {
  return carTrips * AVERAGE_CAR_TRIP_CARBON_KG;
}

export function weightedCarSwitchProbability(cohorts: TransitCohortFixture[]): number {
  const weight = cohorts.reduce((sum, cohort) => sum + cohort.weight, 0);
  if (weight <= 0) return 0;
  const weightedSum = cohorts.reduce((sum, cohort) => sum + cohort.weight * cohort.vehicleAccessProbability, 0);
  return weightedSum / weight;
}
