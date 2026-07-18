import { describe, expect, it } from "vitest";
import {
  findSimilarScenarios,
  getBaselineMarketHours,
  getBaselineRenewableHours,
  listAssets,
  listScenarios,
  requireAsset,
  requireScenario,
} from "@/lib/grid/fixtures";

describe("grid fixtures", () => {
  it("exposes exactly one demo battery asset with sane physical bounds", () => {
    const assets = listAssets();
    expect(assets).toHaveLength(1);
    const asset = requireAsset("ontario-bess-01");
    expect(asset.ratedPowerMw).toBeGreaterThan(0);
    expect(asset.usableEnergyMwh).toBeGreaterThan(0);
    expect(asset.minSocFraction).toBeLessThan(asset.maxSocFraction);
    expect(asset.status).toBe("available");
  });

  it("throws a descriptive error for an unknown asset id", () => {
    expect(() => requireAsset("does-not-exist")).toThrow(/Unknown battery asset/);
  });

  it("has 24 hours of market and renewable baseline data", () => {
    expect(getBaselineMarketHours()).toHaveLength(24);
    expect(getBaselineRenewableHours()).toHaveLength(24);
  });

  it("exposes the full scenario catalog required for the demo", () => {
    const ids = listScenarios().map((scenario) => scenario.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "normal-day",
        "overnight-wind-surplus",
        "evening-demand-peak",
        "demand-forecast-increase",
        "battery-derating",
        "renewable-forecast-miss",
        "combined-adversarial",
      ]),
    );
  });

  it("never exposes hidden stress fields as undefined-shaped visible data", () => {
    const scenario = requireScenario("demand-forecast-increase");
    expect(scenario.visible).toEqual({});
    expect(scenario.hiddenStress).toEqual({ demandMultiplier: 1.12 });
  });

  it("finds similar scenarios by scenario type and tags", () => {
    const results = findSimilarScenarios({ scenarioType: "asset", tags: ["derating"] });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].scenarioType).toBe("asset");
  });
});
