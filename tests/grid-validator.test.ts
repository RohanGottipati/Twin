import { describe, expect, it } from "vitest";
import { requireAsset } from "@/lib/grid/fixtures";
import { resolveScenarioConditions } from "@/lib/grid/scenarios";
import { computeThermalDeratingFraction, validateDispatchPlan } from "@/lib/grid/validator";
import type { ConditionHour, DispatchInterval, DispatchPlan } from "@/lib/grid/types";

const asset = requireAsset("ontario-bess-01");

function buildPlan(
  conditions: ConditionHour[],
  build: (condition: ConditionHour, index: number) => Partial<DispatchInterval>,
  overrides: Partial<DispatchPlan> = {},
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
    scenarioId: "normal-day",
    horizonStart: conditions[0]?.timestamp ?? "",
    intervalMinutes: 60,
    strategy: "test-strategy",
    assumptions: [],
    warnings: [],
    intervals,
    ...overrides,
  };
}

describe("computeThermalDeratingFraction", () => {
  it("returns full power at or below the warning temperature", () => {
    expect(computeThermalDeratingFraction(asset.thermal, 20)).toBe(1);
    expect(computeThermalDeratingFraction(asset.thermal, 34)).toBe(1);
  });

  it("returns the max-temperature fraction at or above max temperature", () => {
    expect(computeThermalDeratingFraction(asset.thermal, 45)).toBe(0.5);
    expect(computeThermalDeratingFraction(asset.thermal, 60)).toBe(0.5);
  });

  it("linearly interpolates between warning and max temperature", () => {
    const midpoint = (asset.thermal.deratingStartTemperatureC + asset.thermal.maxTemperatureC) / 2;
    const fraction = computeThermalDeratingFraction(asset.thermal, midpoint);
    expect(fraction).toBeCloseTo(0.75, 5);
  });
});

describe("validateDispatchPlan", () => {
  it("accepts an idle plan with zero violations", () => {
    const conditions = resolveScenarioConditions("normal-day", asset).visibleHours;
    const plan = buildPlan(conditions, () => ({}));
    const { violations, trace } = validateDispatchPlan(plan, asset, conditions);
    expect(violations.filter((v) => v.severity === "error")).toHaveLength(0);
    expect(trace).toHaveLength(24);
    expect(trace[0].socFractionEnd).toBeCloseTo(asset.startingSocFraction, 6);
  });

  it("rejects a plan targeting the wrong asset", () => {
    const conditions = resolveScenarioConditions("normal-day", asset).visibleHours;
    const plan = buildPlan(conditions, () => ({}), { assetId: "some-other-asset" });
    const { violations } = validateDispatchPlan(plan, asset, conditions);
    expect(violations.some((v) => v.code === "asset-mismatch")).toBe(true);
  });

  it("rejects a plan with a horizon length mismatch", () => {
    const conditions = resolveScenarioConditions("normal-day", asset).visibleHours;
    const plan = buildPlan(conditions.slice(0, 5), () => ({}));
    const { violations } = validateDispatchPlan(plan, asset, conditions);
    expect(violations.some((v) => v.code === "horizon-mismatch")).toBe(true);
  });

  it("flags charging above the rated power limit", () => {
    const conditions = resolveScenarioConditions("normal-day", asset).visibleHours;
    const plan = buildPlan(conditions, (_condition, index) =>
      index === 0 ? { chargeMw: 150 } : {},
    );
    const { violations } = validateDispatchPlan(plan, asset, conditions);
    expect(violations.some((v) => v.code === "charge-exceeds-limit")).toBe(true);
  });

  it("flags a ramp between consecutive intervals larger than the ramp limit", () => {
    const conditions = resolveScenarioConditions("normal-day", asset).visibleHours;
    const plan = buildPlan(conditions, (_condition, index) => {
      if (index === 5) return { dischargeMw: 90 };
      if (index === 6) return { chargeMw: 20 };
      return {};
    });
    const { violations } = validateDispatchPlan(plan, asset, conditions);
    expect(violations.some((v) => v.code === "ramp-limit-exceeded")).toBe(true);
  });

  it("flags state of charge dropping below the minimum", () => {
    const conditions = resolveScenarioConditions("normal-day", asset).visibleHours;
    const plan = buildPlan(conditions, (_condition, index) =>
      index < 10 ? { dischargeMw: 100 } : {},
    );
    const { violations } = validateDispatchPlan(plan, asset, conditions);
    expect(violations.some((v) => v.code === "soc-below-minimum")).toBe(true);
  });

  it("flags state of charge rising above the maximum", () => {
    const conditions = resolveScenarioConditions("normal-day", asset).visibleHours;
    const plan = buildPlan(conditions, (_condition, index) =>
      index < 10 ? { chargeMw: 100 } : {},
    );
    const { violations } = validateDispatchPlan(plan, asset, conditions);
    expect(violations.some((v) => v.code === "soc-above-maximum")).toBe(true);
  });

  it("respects the announced derating window from the battery-derating scenario", () => {
    const conditions = resolveScenarioConditions("battery-derating", asset).visibleHours;
    const plan = buildPlan(conditions, (_condition, index) =>
      index === 18 ? { dischargeMw: 90 } : {},
    );
    const { violations } = validateDispatchPlan(plan, asset, conditions);
    expect(violations.some((v) => v.code === "discharge-exceeds-limit")).toBe(true);
  });

  it("warns, but does not error, when reserve stays below the target across the horizon", () => {
    const conditions = resolveScenarioConditions("normal-day", asset).visibleHours;
    const plan = buildPlan(conditions, () => ({ reserveMw: 0 }));
    const { violations } = validateDispatchPlan(plan, asset, conditions);
    const reserveViolation = violations.find((v) => v.code === "reserve-below-target");
    expect(reserveViolation?.severity).toBe("warning");
    expect(violations.filter((v) => v.severity === "error")).toHaveLength(0);
  });
});
