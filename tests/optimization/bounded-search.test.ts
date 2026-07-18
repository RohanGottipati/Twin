import { describe, expect, it } from "vitest";

import { requireScenario } from "@/data/transit/scenarios";
import { boundedDepartureSearch } from "@/lib/optimization/bounded-search";
import { suggestPpoAction } from "@/lib/optimization/ppo-stub";

describe("boundedDepartureSearch", () => {
  it("returns ranked valid candidates for the flagship scenario", () => {
    const scenario = requireScenario("departure-406-412");
    const ranked = boundedDepartureSearch({
      scenario,
      shiftARange: [-1, 1],
      shiftBRange: [-1, 1],
    });
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0].objective).toBeLessThanOrEqual(ranked[ranked.length - 1].objective);
    expect(ranked.every((candidate) => candidate.result.valid)).toBe(true);
  });
});

describe("suggestPpoAction", () => {
  it("returns a heuristic stub action", () => {
    const action = suggestPpoAction({
      arrivalHistogram: [1, 2, 20, 5],
      departureTimes: ["16:06", "16:12"],
      vehicleLoads: [0.9, 0.4],
      queueLength: 100,
      eventDemandMultiplier: 1.25,
    });
    expect(action.source).toBe("ppo-stub-heuristic");
    expect(action.addEventOnlyTrip).toBe(true);
  });
});
