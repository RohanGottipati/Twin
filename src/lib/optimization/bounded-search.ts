import { simulateTransit } from "@/lib/transit/simulator";
import type { TransitIntervention, TransitScenario, TransitSimulationResult } from "@/lib/transit/schemas";

export interface DepartureShiftCandidate {
  id: string;
  label: string;
  shiftAMinutes: number;
  shiftBMinutes: number;
  intervention: TransitIntervention;
  result: TransitSimulationResult;
  objective: number;
}

export interface BoundedSearchInput {
  scenario: TransitScenario;
  /** Inclusive minute range for shifting the first baseline departure. */
  shiftARange?: [number, number];
  /** Inclusive minute range for shifting the second baseline departure. */
  shiftBRange?: [number, number];
  seed?: number;
}

/**
 * Bounded exhaustive search over small departure shifts for the flagship
 * two-departure window (§12.1 baseline 3). Objective: lower mean wait,
 * denied boardings, and load imbalance; hard-invalid results are discarded.
 */
export function boundedDepartureSearch(input: BoundedSearchInput): DepartureShiftCandidate[] {
  const [aMin, aMax] = input.shiftARange ?? [-3, 4];
  const [bMin, bMax] = input.shiftBRange ?? [-3, 4];
  const seed = input.seed ?? 20260718;
  const [depA, depB] = input.scenario.baselineDepartures;
  const candidates: DepartureShiftCandidate[] = [];

  for (let shiftA = aMin; shiftA <= aMax; shiftA += 1) {
    for (let shiftB = bMin; shiftB <= bMax; shiftB += 1) {
      const id = `search-a${shiftA}-b${shiftB}`;
      const intervention: TransitIntervention = {
        id,
        label: `Shift ${depA} by ${shiftA}m, ${depB} by ${shiftB}m`,
        actions: [
          { type: "shift_departure_minutes", departureId: depA, deltaMinutes: shiftA },
          { type: "shift_departure_minutes", departureId: depB, deltaMinutes: shiftB },
        ],
      };
      const result = simulateTransit({
        schemaVersion: 1,
        scenario: input.scenario,
        intervention,
        stressOverlay: null,
        seed,
      });
      if (!result.valid) continue;
      const objective =
        result.metrics.meanWaitMinutes * 2 +
        result.metrics.deniedBoardings * 0.05 +
        result.metrics.loadImbalance * 10 +
        result.metrics.missedTransfers * 0.5;
      candidates.push({
        id,
        label: intervention.label,
        shiftAMinutes: shiftA,
        shiftBMinutes: shiftB,
        intervention,
        result,
        objective,
      });
    }
  }

  return candidates.sort((a, b) => a.objective - b.objective);
}
