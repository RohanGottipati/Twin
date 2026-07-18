import { describe, expect, it } from "vitest";

import {
  ASSISTANT_ROSTER,
  CONCERT_BUNDLE,
  CORE_SCHEDULE_BUNDLE,
  WEATHER_BUNDLE,
  selectAssistantBundle,
} from "@/lib/backboard/assistants";
import { FLAGSHIP_SCENARIO_ID, listScenarios } from "@/data/transit/scenarios";

describe("bundle definitions", () => {
  it("CONCERT_BUNDLE and WEATHER_BUNDLE only reference real roster keys", () => {
    for (const key of [...CONCERT_BUNDLE, ...WEATHER_BUNDLE]) {
      expect(ASSISTANT_ROSTER[key]).toBeDefined();
    }
  });

  it("CONCERT_BUNDLE has no roles already in CORE_SCHEDULE_BUNDLE", () => {
    const core = new Set<string>(CORE_SCHEDULE_BUNDLE);
    for (const key of CONCERT_BUNDLE) {
      expect(core.has(key)).toBe(false);
    }
  });
});

describe("selectAssistantBundle scenario selection", () => {
  it("selects the core bundle by default for every registered scenario", () => {
    for (const scenario of listScenarios()) {
      const bundle = selectAssistantBundle(scenario.id);
      for (const role of CORE_SCHEDULE_BUNDLE) {
        expect(bundle).toContain(role);
      }
    }
  });

  it("scales up in size as more optional bundles are requested", () => {
    const core = selectAssistantBundle("streetcar-midday-queen").length;
    const withConcert = selectAssistantBundle("streetcar-midday-queen", { includeConcert: true }).length;
    const withBoth = selectAssistantBundle("streetcar-midday-queen", {
      includeConcert: true,
      includeWeather: true,
    }).length;
    expect(withConcert).toBeGreaterThan(core);
    expect(withBoth).toBeGreaterThanOrEqual(withConcert);
  });

  it("returns a plain array (not the frozen readonly bundle constant) so callers can safely mutate a copy", () => {
    const bundle = selectAssistantBundle(FLAGSHIP_SCENARIO_ID);
    expect(Array.isArray(bundle)).toBe(true);
    expect(() => bundle.push("safety")).not.toThrow();
  });

  it("is deterministic for the same scenario and options", () => {
    const first = selectAssistantBundle(FLAGSHIP_SCENARIO_ID, { includeWeather: true });
    const second = selectAssistantBundle(FLAGSHIP_SCENARIO_ID, { includeWeather: true });
    expect(first.sort()).toEqual(second.sort());
  });

  it("treats an unknown scenario id like any non-flagship scenario rather than throwing", () => {
    expect(() => selectAssistantBundle("not-a-real-scenario")).not.toThrow();
    const bundle = selectAssistantBundle("not-a-real-scenario");
    expect(bundle).not.toContain("concert-event");
  });
});
