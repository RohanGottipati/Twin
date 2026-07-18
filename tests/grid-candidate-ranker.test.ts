import { describe, expect, it } from "vitest";
import { DEFAULT_OBJECTIVE_WEIGHTS, rankCandidates } from "@/lib/grid/candidate-ranker";
import type { SimulationResult } from "@/lib/grid/types";

function makeResult(overrides: Partial<SimulationResult["metrics"]>, valid = true): SimulationResult {
  return {
    assetId: "ontario-bess-01",
    scenarioId: "normal-day",
    valid,
    violations: valid
      ? []
      : [{ code: "charge-exceeds-limit", severity: "error", hour: 0, message: "too much charge" }],
    metrics: {
      netValueCad: 0,
      energyRevenueCad: 0,
      reserveRevenueCad: 0,
      degradationCostCad: 0,
      totalChargeMwh: 0,
      totalDischargeMwh: 0,
      equivalentFullCycles: 0,
      carbonAvoidedKg: 0,
      renewableCapturedMwh: 0,
      minSocFraction: 0.5,
      maxSocFraction: 0.5,
      finalSocFraction: 0.5,
      ...overrides,
    },
    trace: [],
  };
}

describe("rankCandidates", () => {
  it("ranks a higher net-value candidate above a lower one, all else equal", () => {
    const ranked = rankCandidates([
      { candidateId: "low", result: makeResult({ netValueCad: 1000 }) },
      { candidateId: "high", result: makeResult({ netValueCad: 5000 }) },
    ]);
    expect(ranked[0].candidateId).toBe("high");
    expect(ranked[0].rank).toBe(1);
    expect(ranked[1].candidateId).toBe("low");
    expect(ranked[1].rank).toBe(2);
  });

  it("always ranks disqualified candidates below every valid candidate", () => {
    const ranked = rankCandidates([
      { candidateId: "invalid", result: makeResult({ netValueCad: 999999 }, false) },
      { candidateId: "valid", result: makeResult({ netValueCad: 1 }) },
    ]);
    const valid = ranked.find((r) => r.candidateId === "valid");
    const invalid = ranked.find((r) => r.candidateId === "invalid");
    expect(valid?.disqualified).toBe(false);
    expect(invalid?.disqualified).toBe(true);
    expect(invalid?.rank).toBeGreaterThan(valid?.rank ?? 0);
    expect(invalid?.score).toBe(Number.NEGATIVE_INFINITY);
    expect(invalid?.disqualifyReason).toMatch(/charge/);
  });

  it("does not throw and assigns rank 1 when there is exactly one valid candidate", () => {
    const ranked = rankCandidates([{ candidateId: "only", result: makeResult({ netValueCad: 250 }) }]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].rank).toBe(1);
    expect(ranked[0].score).toBeGreaterThan(0);
  });

  it("weights renewable capture and carbon avoided when net value ties", () => {
    const ranked = rankCandidates(
      [
        { candidateId: "greener", result: makeResult({ netValueCad: 100, renewableCapturedMwh: 80, carbonAvoidedKg: 500 }) },
        { candidateId: "browner", result: makeResult({ netValueCad: 100, renewableCapturedMwh: 0, carbonAvoidedKg: 0 }) },
      ],
      DEFAULT_OBJECTIVE_WEIGHTS,
    );
    expect(ranked[0].candidateId).toBe("greener");
  });
});
