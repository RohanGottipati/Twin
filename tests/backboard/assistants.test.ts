import { describe, expect, it } from "vitest";

import {
  ASSISTANT_ROSTER,
  CONCERT_BUNDLE,
  CORE_SCHEDULE_BUNDLE,
  WEATHER_BUNDLE,
  getAssistantRole,
  listAssistantRoles,
  selectAssistantBundle,
  type AssistantRoleKey,
} from "@/lib/backboard/assistants";
import { FLAGSHIP_SCENARIO_ID } from "@/data/transit/scenarios";

describe("ASSISTANT_ROSTER", () => {
  it("has exactly 54 unique role keys", () => {
    const keys = Object.keys(ASSISTANT_ROSTER);
    expect(keys.length).toBe(54);
    expect(new Set(keys).size).toBe(54);
  });

  it("has a unique assistant name for every role", () => {
    const names = Object.values(ASSISTANT_ROSTER).map((role) => role.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("never mentions GridTwin, the retired battery-control-room demo, in any active roster name", () => {
    for (const role of Object.values(ASSISTANT_ROSTER)) {
      expect(role.name).not.toMatch(/gridtwin/i);
      expect(role.shortDescription).not.toMatch(/gridtwin/i);
    }
  });

  it("every role name identifies it as part of TwinTO", () => {
    for (const role of Object.values(ASSISTANT_ROSTER)) {
      expect(role.name).toMatch(/^TwinTO —/);
    }
  });

  it("every system prompt carries the shared non-negotiable guard", () => {
    for (const role of Object.values(ASSISTANT_ROSTER)) {
      expect(role.systemPrompt).toContain("You must never represent simulated citizen reactions as real public opinion.");
      expect(role.systemPrompt).toContain("You must never reveal private chain-of-thought.");
    }
  });

  it("every role's key matches its own record's key field", () => {
    for (const [key, role] of Object.entries(ASSISTANT_ROSTER)) {
      expect(role.key).toBe(key);
    }
  });

  it("getAssistantRole resolves a role by key", () => {
    const role = getAssistantRole("final-policy-judge");
    expect(role.key).toBe("final-policy-judge");
    expect(role.name).toContain("Final Policy Judge");
  });

  it("listAssistantRoles returns every roster entry", () => {
    expect(listAssistantRoles()).toHaveLength(54);
  });

  it("only the Memory Curator has non-Readonly memory access other than the adversarial stress agent's off", () => {
    const nonReadonly = Object.values(ASSISTANT_ROSTER).filter((role) => role.memory !== "Readonly");
    const byKey = new Map(nonReadonly.map((role) => [role.key, role.memory]));
    expect(byKey.get("memory-curator")).toBe("Auto");
    expect(byKey.get("adversarial-stress")).toBe("off");
  });
});

describe("CORE_SCHEDULE_BUNDLE", () => {
  it("has 19 unique roles that all exist in the roster", () => {
    expect(CORE_SCHEDULE_BUNDLE.length).toBe(19);
    expect(new Set(CORE_SCHEDULE_BUNDLE).size).toBe(CORE_SCHEDULE_BUNDLE.length);
    for (const key of CORE_SCHEDULE_BUNDLE) {
      expect(ASSISTANT_ROSTER[key]).toBeDefined();
    }
  });

  it("always includes the final policy judge and evidence auditor", () => {
    expect(CORE_SCHEDULE_BUNDLE).toContain("final-policy-judge");
    expect(CORE_SCHEDULE_BUNDLE).toContain("evidence-auditor");
  });
});

describe("selectAssistantBundle", () => {
  it("returns at least 18 unique roles for the flagship scenario departure-406-412", () => {
    const bundle = selectAssistantBundle(FLAGSHIP_SCENARIO_ID);
    expect(bundle.length).toBeGreaterThanOrEqual(18);
    expect(new Set(bundle).size).toBe(bundle.length);
  });

  it("always includes the concert bundle for the flagship scenario, even without an explicit flag", () => {
    const bundle = selectAssistantBundle(FLAGSHIP_SCENARIO_ID);
    for (const key of CONCERT_BUNDLE) {
      expect(bundle).toContain(key);
    }
  });

  it("does not include the concert bundle for a non-flagship scenario by default", () => {
    const bundle = selectAssistantBundle("streetcar-midday-queen");
    for (const key of CONCERT_BUNDLE) {
      expect(bundle).not.toContain(key);
    }
  });

  it("adds the concert bundle to a non-flagship scenario when includeConcert is set", () => {
    const bundle = selectAssistantBundle("streetcar-midday-queen", { includeConcert: true });
    for (const key of CONCERT_BUNDLE) {
      expect(bundle).toContain(key);
    }
  });

  it("adds the weather bundle only when includeWeather is set", () => {
    const without = selectAssistantBundle("streetcar-midday-queen");
    const withWeather = selectAssistantBundle("streetcar-midday-queen", { includeWeather: true });
    const notAlreadyInCore = WEATHER_BUNDLE.filter((key) => !(CORE_SCHEDULE_BUNDLE as readonly string[]).includes(key));
    expect(notAlreadyInCore.length).toBeGreaterThan(0);
    for (const key of notAlreadyInCore) {
      expect(without).not.toContain(key);
    }
    for (const key of WEATHER_BUNDLE) {
      expect(withWeather).toContain(key);
    }
  });

  it("deduplicates roles shared across the core, concert, and weather bundles", () => {
    const bundle = selectAssistantBundle(FLAGSHIP_SCENARIO_ID, { includeWeather: true });
    expect(new Set(bundle).size).toBe(bundle.length);
  });

  it("only returns roles that exist in the roster", () => {
    const bundle = selectAssistantBundle(FLAGSHIP_SCENARIO_ID, { includeWeather: true });
    for (const key of bundle as AssistantRoleKey[]) {
      expect(ASSISTANT_ROSTER[key]).toBeDefined();
    }
  });
});
