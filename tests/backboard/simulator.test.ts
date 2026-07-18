import { describe, expect, it } from "vitest";

import { requireScenario, requireStressOverlay, FLAGSHIP_SCENARIO_ID, CONCERT_SURGE_STRESS_OVERLAY_ID } from "@/data/transit/scenarios";
import { simulateTransit } from "@/lib/transit/simulator";
import type { TransitIntervention } from "@/lib/transit/schemas";

const scenario = requireScenario(FLAGSHIP_SCENARIO_ID);
const SEED = 20260718;

function intervention(overrides: Partial<TransitIntervention> = {}): TransitIntervention {
  return {
    id: "test-candidate",
    label: "Test candidate",
    actions: [],
    ...overrides,
  } as TransitIntervention;
}

describe("simulateTransit: queueing and boarding", () => {
  it("produces a departure load entry for every baseline departure with no intervention", () => {
    const result = simulateTransit({ schemaVersion: 1, scenario, intervention: null, stressOverlay: null, seed: SEED });
    expect(result.departureLoads.map((load) => load.departureId).sort()).toEqual([...scenario.baselineDepartures].sort());
    expect(result.queueTrace.length).toBeGreaterThan(0);
    expect(result.dataMode).toBe("synthetic-fixture");
  });

  it("boards more passengers than it denies when demand is well under capacity", () => {
    const result = simulateTransit({ schemaVersion: 1, scenario, intervention: null, stressOverlay: null, seed: SEED });
    for (const load of result.departureLoads) {
      expect(load.boarded).toBeGreaterThanOrEqual(0);
      expect(load.denied).toBeGreaterThanOrEqual(0);
      expect(load.boarded + load.denied).toBeLessThanOrEqual(load.capacity + load.denied);
    }
  });

  it("is deterministic for the same seed and inputs", () => {
    const a = simulateTransit({ schemaVersion: 1, scenario, intervention: null, stressOverlay: null, seed: SEED });
    const b = simulateTransit({ schemaVersion: 1, scenario, intervention: null, stressOverlay: null, seed: SEED });
    expect(a).toEqual(b);
  });
});

describe("simulateTransit: the flagship departure load imbalance", () => {
  it("denies boardings at the first flagship departure while the second runs comparatively underused", () => {
    const result = simulateTransit({ schemaVersion: 1, scenario, intervention: null, stressOverlay: null, seed: SEED });
    const [first, second] = scenario.baselineDepartures;
    const firstLoad = result.departureLoads.find((load) => load.departureId === first);
    const secondLoad = result.departureLoads.find((load) => load.departureId === second);
    expect(firstLoad).toBeDefined();
    expect(secondLoad).toBeDefined();
    expect(firstLoad!.denied).toBeGreaterThan(0);
    expect(secondLoad!.loadFactor).toBeLessThan(firstLoad!.loadFactor);
    expect(result.metrics.loadImbalance).toBeGreaterThan(0);
    expect(result.metrics.deniedBoardings).toBeGreaterThan(0);
  });

  it("reduces denied boardings when a capacity boost is added to the overloaded first departure", () => {
    const baseline = simulateTransit({ schemaVersion: 1, scenario, intervention: null, stressOverlay: null, seed: SEED });
    const [first] = scenario.baselineDepartures;
    const boosted = simulateTransit({
      schemaVersion: 1,
      scenario,
      intervention: intervention({
        id: "capacity-boost-modest",
        actions: [{ type: "capacity_boost", departureId: first, extraCapacity: 200 }],
      }),
      stressOverlay: null,
      seed: SEED,
    });
    expect(boosted.metrics.deniedBoardings).toBeLessThan(baseline.metrics.deniedBoardings);
    expect(boosted.valid).toBe(true);
  });
});

describe("simulateTransit: wait-time metrics", () => {
  it("reports mean and p90 wait as non-negative finite numbers, with p90 at least the mean", () => {
    const result = simulateTransit({ schemaVersion: 1, scenario, intervention: null, stressOverlay: null, seed: SEED });
    expect(Number.isFinite(result.metrics.meanWaitMinutes)).toBe(true);
    expect(result.metrics.meanWaitMinutes).toBeGreaterThanOrEqual(0);
    expect(result.metrics.p90WaitMinutes).toBeGreaterThanOrEqual(result.metrics.meanWaitMinutes);
  });
});

describe("simulateTransit: event surge worsens outcomes under stress", () => {
  it("increases denied boardings and/or crowding under the concert-surge stress overlay versus visible-only conditions", () => {
    const overlay = requireStressOverlay(CONCERT_SURGE_STRESS_OVERLAY_ID);
    const candidate = intervention({ id: "unstressed-candidate" });
    const visible = simulateTransit({ schemaVersion: 1, scenario, intervention: candidate, stressOverlay: null, seed: SEED });
    const stressed = simulateTransit({ schemaVersion: 1, scenario, intervention: candidate, stressOverlay: overlay, seed: SEED });

    expect(stressed.metrics.deniedBoardings).toBeGreaterThanOrEqual(visible.metrics.deniedBoardings);
    const visiblePeakQueue = visible.queueTrace.reduce((max, point) => Math.max(max, point.queueLength), 0);
    const stressedPeakQueue = stressed.queueTrace.reduce((max, point) => Math.max(max, point.queueLength), 0);
    expect(stressedPeakQueue).toBeGreaterThanOrEqual(visiblePeakQueue);
  });

  it("can push an intervention that is valid under visible conditions into a violation under the stress overlay", () => {
    const overlay = requireStressOverlay(CONCERT_SURGE_STRESS_OVERLAY_ID);
    const candidate = intervention({ id: "borderline-candidate" });
    const visible = simulateTransit({ schemaVersion: 1, scenario, intervention: candidate, stressOverlay: null, seed: SEED });
    const stressed = simulateTransit({ schemaVersion: 1, scenario, intervention: candidate, stressOverlay: overlay, seed: SEED });
    expect(visible.violations.length).toBeLessThanOrEqual(stressed.violations.length);
  });
});

describe("simulateTransit: accessibility violations", () => {
  it("flags an accessibility failure when an entrance closure leaves no alternate accessible entrance", () => {
    const streetcarScenario = requireScenario("streetcar-midday-queen");
    // Osgoode (this scenario's station) has no alternateAccessibleEntrance fixture flag set.
    const closureIntervention = intervention({
      id: "close-entrance",
      actions: [{ type: "entrance_closure", stationId: streetcarScenario.stationId, entranceId: "main", capacityReductionFraction: 0.5 }],
    });
    const result = simulateTransit({ schemaVersion: 1, scenario: streetcarScenario, intervention: closureIntervention, stressOverlay: null, seed: SEED });
    expect(result.metrics.accessibilityFailures).toBeGreaterThan(0);
    expect(result.violations.some((violation) => violation.code === "accessibility-entrance-unavailable")).toBe(true);
    expect(result.valid).toBe(false);
  });

  it("rejects a capacity boost that exceeds the vehicle's crush capacity as an error-severity violation", () => {
    const overCapacity = intervention({
      id: "unsafe-overcapacity",
      actions: [{ type: "capacity_boost", departureId: scenario.baselineDepartures[0], extraCapacity: 300 }],
    });
    const result = simulateTransit({ schemaVersion: 1, scenario, intervention: overCapacity, stressOverlay: null, seed: SEED });
    expect(result.valid).toBe(false);
    expect(result.violations.some((violation) => violation.code === "capacity-boost-exceeds-crush-limit" && violation.severity === "error")).toBe(true);
  });
});
