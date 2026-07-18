import { describe, expect, it } from "vitest";
import { requireAsset } from "@/lib/grid/fixtures";
import { resolveScenarioConditions } from "@/lib/grid/scenarios";

const asset = requireAsset("ontario-bess-01");

describe("resolveScenarioConditions", () => {
  it("returns identical visible and actual hours for the normal-day scenario", () => {
    const conditions = resolveScenarioConditions("normal-day", asset);
    expect(conditions.visibleHours).toHaveLength(24);
    expect(conditions.actualHours).toEqual(conditions.visibleHours);
    expect(conditions.hiddenStressDescription).toBeNull();
  });

  it("boosts overnight wind and depresses overnight price for overnight-wind-surplus", () => {
    const conditions = resolveScenarioConditions("overnight-wind-surplus", asset);
    const baselineHourZero = 2200 * 1.8;
    expect(conditions.visibleHours[0].windMw).toBeCloseTo(baselineHourZero, 1);
    expect(conditions.visibleHours[0].priceCadPerMwh).toBeCloseTo(12 * 0.35, 1);
    // Daytime hours are untouched.
    expect(conditions.visibleHours[12].windMw).toBe(900);
  });

  it("keeps hidden stress out of visibleHours but applies it to actualHours", () => {
    const conditions = resolveScenarioConditions("demand-forecast-increase", asset);
    expect(conditions.visibleHours[10].demandMw).toBe(17500);
    expect(conditions.actualHours[10].demandMw).toBeCloseTo(17500 * 1.12, 1);
    expect(conditions.hiddenStressDescription).toMatch(/12%/);
  });

  it("applies announced derating to deratedRatedPowerMw during the affected hours only", () => {
    const conditions = resolveScenarioConditions("battery-derating", asset);
    expect(conditions.visibleHours[18].deratedRatedPowerMw).toBeCloseTo(100 * 0.7, 5);
    expect(conditions.visibleHours[10].deratedRatedPowerMw).toBe(100);
  });

  it("combines wind shortfall and demand surprise as hidden stress for combined-adversarial", () => {
    const conditions = resolveScenarioConditions("combined-adversarial", asset);
    expect(conditions.visibleHours[0].windMw).toBe(2200);
    expect(conditions.actualHours[0].windMw).toBeCloseTo(2200 * 0.5, 1);
    expect(conditions.visibleHours[18].deratedRatedPowerMw).toBeCloseTo(70, 5);
    expect(conditions.actualHours[17].demandMw).toBeCloseTo(18900 * 1.12, 1);
  });

  it("throws for an unknown scenario id", () => {
    expect(() => resolveScenarioConditions("not-a-scenario", asset)).toThrow(/Unknown scenario/);
  });
});
