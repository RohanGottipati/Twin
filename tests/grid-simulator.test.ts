import { describe, expect, it } from "vitest";
import { requireAsset } from "@/lib/grid/fixtures";
import { resolveScenarioConditions } from "@/lib/grid/scenarios";
import { simulateDispatchPlan } from "@/lib/grid/simulator";
import type { ConditionHour, DispatchInterval, DispatchPlan } from "@/lib/grid/types";

const asset = requireAsset("ontario-bess-01");

function buildPlan(
  conditions: ConditionHour[],
  build: (condition: ConditionHour, index: number) => Partial<DispatchInterval>,
  scenarioId = "normal-day",
): DispatchPlan {
  const intervals: DispatchInterval[] = conditions.map((condition, index) => ({
    timestamp: condition.timestamp,
    chargeMw: 0,
    dischargeMw: 0,
    reserveMw: 0,
    rationale: "test interval",
    confidence: 0.6,
    ...build(condition, index),
  }));

  return {
    schemaVersion: 1,
    assetId: asset.id,
    scenarioId,
    horizonStart: conditions[0]?.timestamp ?? "",
    intervalMinutes: 60,
    strategy: "test-strategy",
    assumptions: [],
    warnings: [],
    intervals,
  };
}

describe("simulateDispatchPlan", () => {
  it("returns zeroed-out metrics for a fully idle plan", () => {
    const conditions = resolveScenarioConditions("normal-day", asset).visibleHours;
    const plan = buildPlan(conditions, () => ({}));
    const result = simulateDispatchPlan(plan, asset, conditions);

    expect(result.valid).toBe(true);
    expect(result.metrics.netValueCad).toBe(0);
    expect(result.metrics.totalChargeMwh).toBe(0);
    expect(result.metrics.totalDischargeMwh).toBe(0);
    expect(result.metrics.equivalentFullCycles).toBe(0);
    expect(result.metrics.finalSocFraction).toBeCloseTo(asset.startingSocFraction, 6);
  });

  it("produces positive net value for a plan that charges cheap and discharges expensive", () => {
    const conditions = resolveScenarioConditions("normal-day", asset).visibleHours;
    // Charge during the cheap overnight hours (2-4), discharge during the expensive evening peak (18-19).
    const plan = buildPlan(conditions, (_condition, index) => {
      if ([2, 3, 4].includes(index)) return { chargeMw: 40, reserveMw: 20 };
      if ([18, 19].includes(index)) return { dischargeMw: 40, reserveMw: 20 };
      return { reserveMw: 20 };
    });
    const result = simulateDispatchPlan(plan, asset, conditions);

    expect(result.valid).toBe(true);
    expect(result.metrics.netValueCad).toBeGreaterThan(0);
    expect(result.metrics.energyRevenueCad).toBeGreaterThan(0);
    expect(result.metrics.totalChargeMwh).toBeCloseTo(120, 5);
    expect(result.metrics.totalDischargeMwh).toBeCloseTo(80, 5);
  });

  it("marks the result invalid and still returns partial metrics when constraints are violated", () => {
    const conditions = resolveScenarioConditions("normal-day", asset).visibleHours;
    const plan = buildPlan(conditions, (_condition, index) => (index === 0 ? { chargeMw: 500 } : {}));
    const result = simulateDispatchPlan(plan, asset, conditions);

    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.code === "charge-exceeds-limit")).toBe(true);
    expect(result.trace.length).toBeGreaterThan(0);
  });

  it("computes carbon avoided as positive when discharging during a high-emission hour", () => {
    const conditions = resolveScenarioConditions("normal-day", asset).visibleHours;
    const plan = buildPlan(conditions, (_condition, index) => (index === 18 ? { dischargeMw: 30 } : {}));
    const result = simulateDispatchPlan(plan, asset, conditions);
    const hourEighteen = result.trace.find((t) => t.hour === 18);

    expect(hourEighteen?.carbonAvoidedKg).toBeGreaterThan(0);
    expect(result.metrics.carbonAvoidedKg).toBeGreaterThan(0);
  });

  it("keeps scenarioId on the result equal to the plan's scenarioId", () => {
    const conditions = resolveScenarioConditions("evening-demand-peak", asset).visibleHours;
    const plan = buildPlan(conditions, () => ({}), "evening-demand-peak");
    const result = simulateDispatchPlan(plan, asset, conditions);
    expect(result.scenarioId).toBe("evening-demand-peak");
  });
});
