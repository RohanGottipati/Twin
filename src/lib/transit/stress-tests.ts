import type { TransitCohortFixture } from "@/data/transit/cohorts";
import { simulateTransit } from "@/lib/transit/simulator";
import type {
  TransitIntervention,
  TransitScenario,
  TransitSimulationResult,
  TransitStressOverlay,
} from "@/lib/transit/schemas";

/**
 * Adversarial stress testing for a candidate intervention
 * (docs/techto-implementation.md section 2.5 and section 13, "Adversarial
 * Stress-Test Agent"). Runs the same intervention twice, once under normal
 * conditions and once with a combined event overlay (concert surge plus
 * entrance closure plus delays) layered on top, and flags any candidate
 * that only looks safe under normal conditions.
 */

export interface StressTestOutcome {
  interventionId: string;
  stressOverlayId: string;
  /** The intervention alone, no stress overlay. */
  baseline: TransitSimulationResult;
  /** The intervention with the stress overlay applied on top. */
  stressed: TransitSimulationResult;
  invalidated: boolean;
  invalidationReasons: string[];
}

export function stressTestIntervention(
  scenario: TransitScenario,
  intervention: TransitIntervention,
  stressOverlay: TransitStressOverlay,
  seed: number,
  cohorts?: TransitCohortFixture[],
): StressTestOutcome {
  const baseline = simulateTransit({
    schemaVersion: 1,
    scenario,
    intervention,
    stressOverlay: null,
    seed,
    cohorts,
  });
  const stressed = simulateTransit({
    schemaVersion: 1,
    scenario,
    intervention,
    stressOverlay,
    seed,
    cohorts,
  });

  const invalidationReasons: string[] = [];

  if (baseline.valid && !stressed.valid) {
    invalidationReasons.push(
      "This intervention only passes safety checks under normal conditions; it fails once the stress overlay is applied.",
    );
  }

  for (const violation of stressed.violations) {
    if (violation.severity === "error") {
      invalidationReasons.push(violation.message);
    }
  }

  if (stressed.metrics.accessibilityFailures > baseline.metrics.accessibilityFailures) {
    invalidationReasons.push(
      `Accessibility failures rise from ${baseline.metrics.accessibilityFailures} to ${stressed.metrics.accessibilityFailures} under stress.`,
    );
  }

  return {
    interventionId: intervention.id,
    stressOverlayId: stressOverlay.id,
    baseline,
    stressed,
    invalidated: !stressed.valid || invalidationReasons.length > 0,
    invalidationReasons: Array.from(new Set(invalidationReasons)),
  };
}

/** Stress-tests every candidate intervention against the same overlay and seed, for a like-for-like comparison. */
export function stressTestCandidates(
  scenario: TransitScenario,
  interventions: TransitIntervention[],
  stressOverlay: TransitStressOverlay,
  seed: number,
  cohorts?: TransitCohortFixture[],
): StressTestOutcome[] {
  return interventions.map((intervention) =>
    stressTestIntervention(scenario, intervention, stressOverlay, seed, cohorts),
  );
}

/** Convenience filter: interventions that failed the stress test and should be revised or rejected before being recommended. */
export function invalidatedCandidateIds(outcomes: StressTestOutcome[]): string[] {
  return outcomes.filter((outcome) => outcome.invalidated).map((outcome) => outcome.interventionId);
}
