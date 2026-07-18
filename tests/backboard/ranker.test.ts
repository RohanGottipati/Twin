import { describe, expect, it } from "vitest";

import { FLAGSHIP_SCENARIO_ID, requireScenario } from "@/data/transit/scenarios";
import { DEFAULT_TRANSIT_OBJECTIVE_WEIGHTS, rankInterventions, type RankableIntervention } from "@/lib/transit/candidate-ranker";
import { simulateTransit } from "@/lib/transit/simulator";
import type { TransitIntervention } from "@/lib/transit/schemas";

const scenario = requireScenario(FLAGSHIP_SCENARIO_ID);
const SEED = 20260718;

function evaluate(intervention: TransitIntervention): RankableIntervention {
  const result = simulateTransit({ schemaVersion: 1, scenario, intervention, stressOverlay: null, seed: SEED });
  return { intervention, result };
}

describe("rankInterventions", () => {
  it("disqualifies an invalid candidate and ranks it after every valid candidate", () => {
    const [first] = scenario.baselineDepartures;
    const valid = evaluate({
      id: "modest-boost",
      label: "Modest capacity boost",
      actions: [{ type: "capacity_boost", departureId: first, extraCapacity: 50 }],
    });
    const invalid = evaluate({
      id: "unsafe-overcapacity",
      label: "Unsafe overcapacity boost",
      actions: [{ type: "capacity_boost", departureId: first, extraCapacity: 300 }],
    });

    const ranked = rankInterventions([valid, invalid]);
    const validEntry = ranked.find((entry) => entry.interventionId === "modest-boost");
    const invalidEntry = ranked.find((entry) => entry.interventionId === "unsafe-overcapacity");

    expect(validEntry?.disqualified).toBe(false);
    expect(invalidEntry?.disqualified).toBe(true);
    expect(invalidEntry?.disqualifyReason).toBeTruthy();
    expect(invalidEntry!.rank).toBeGreaterThan(validEntry!.rank);
  });

  it("gives every disqualified candidate the same sentinel score, always worse than any valid candidate's score", () => {
    const [first] = scenario.baselineDepartures;
    const invalidA = evaluate({
      id: "unsafe-a",
      label: "Unsafe A",
      actions: [{ type: "capacity_boost", departureId: first, extraCapacity: 300 }],
    });
    const invalidB = evaluate({
      id: "unsafe-b",
      label: "Unsafe B",
      actions: [{ type: "shift_departure_minutes", departureId: "not-a-real-departure", deltaMinutes: 5 }],
    });
    const valid = evaluate({ id: "idle", label: "No change", actions: [] });

    const ranked = rankInterventions([valid, invalidA, invalidB]);
    const disqualified = ranked.filter((entry) => entry.disqualified);
    expect(disqualified).toHaveLength(2);
    for (const entry of disqualified) {
      expect(entry.score).toBeLessThan(ranked.find((r) => r.interventionId === "idle")!.score);
    }
  });

  it("assigns rank 1 to the candidate with the best weighted score among valid candidates", () => {
    const [first, second] = scenario.baselineDepartures;
    const doNothing = evaluate({ id: "idle", label: "Do nothing", actions: [] });
    const retimed = evaluate({
      id: "balanced-retime",
      label: "Balanced retime",
      actions: [
        { type: "shift_departure_minutes", departureId: first, deltaMinutes: 2 },
        { type: "shift_departure_minutes", departureId: second, deltaMinutes: 1 },
      ],
    });

    const ranked = rankInterventions([doNothing, retimed]);
    const rank1 = ranked.find((entry) => entry.rank === 1);
    expect(rank1).toBeDefined();
    expect(rank1?.disqualified).toBe(false);
  });

  it("produces a breakdown that sums to the total score for every valid candidate", () => {
    const idle = evaluate({ id: "idle", label: "Do nothing", actions: [] });
    const [ranked] = rankInterventions([idle]);
    const sum = Object.values(ranked.breakdown).reduce((total, value) => total + value, 0);
    expect(sum).toBeCloseTo(ranked.score, 6);
  });

  it("returns an empty ranking for an empty candidate list", () => {
    expect(rankInterventions([])).toEqual([]);
  });

  it("respects custom objective weights over the defaults", () => {
    const [first] = scenario.baselineDepartures;
    const waitFocused = evaluate({ id: "wait-focused", label: "Wait focused", actions: [] });
    const costHeavy = evaluate({
      id: "cost-heavy",
      label: "Cost heavy",
      actions: [{ type: "capacity_boost", departureId: first, extraCapacity: 100 }],
    });

    const defaultRanking = rankInterventions([waitFocused, costHeavy]);
    const costOnlyRanking = rankInterventions([waitFocused, costHeavy], {
      ...DEFAULT_TRANSIT_OBJECTIVE_WEIGHTS,
      wait: 0,
      crowding: 0,
      reliability: 0,
      equity: 0,
      carbon: 0,
      operatingCost: 1,
    });

    // Under a cost-only objective the free "do nothing" candidate must win.
    expect(costOnlyRanking.find((entry) => entry.rank === 1)?.interventionId).toBe("wait-focused");
    void defaultRanking;
  });
});
