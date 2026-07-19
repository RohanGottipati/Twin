import { describe, expect, it } from "vitest";

import {
  ASSISTANT_ROSTER,
  INTENT_BUNDLES,
  selectAssistantsForIntent,
  selectAssistantBundle,
} from "@/lib/backboard/assistants";
import { classifyPlanningIntent } from "@/lib/techto/intent";
import { FLAGSHIP_SCENARIO_ID } from "@/data/transit/scenarios";

describe("intent activation", () => {
  it("classifies common chat phrases into the expected intents", () => {
    expect(classifyPlanningIntent("Show Liberty Village on the map")).toBe("SIMPLE_MAP_NAVIGATION");
    expect(classifyPlanningIntent("Why was this candidate ranked first?")).toBe("SIMPLE_EXPLANATION");
    expect(classifyPlanningIntent("What is the best neighbourhood to add a subway station?")).toBe(
      "NEW_STATION_LOCATION",
    );
    expect(classifyPlanningIntent("What happens if the 4:06 train is moved to 4:08?")).toBe("SCHEDULE_CHANGE");
    expect(classifyPlanningIntent("How should service change after a concert at Scotiabank Arena?")).toBe(
      "EVENT_RESPONSE",
    );
    expect(classifyPlanningIntent("Compare the first and second options")).toBe("COMPARE_EXISTING_CANDIDATES");
  });

  it("keeps compare and navigation bundles small", () => {
    expect(selectAssistantsForIntent("COMPARE_EXISTING_CANDIDATES").length).toBeLessThanOrEqual(5);
    expect(selectAssistantsForIntent("SIMPLE_EXPLANATION")).toEqual([
      ...INTENT_BUNDLES.SIMPLE_EXPLANATION,
    ]);
  });

  it("schedule questions still activate feasibility (ops tools), not a niche events agent", () => {
    const bundle = selectAssistantsForIntent("SCHEDULE_CHANGE");
    expect(bundle).toContain("feasibility");
    expect(bundle).toContain("scenario-designer");
  });

  it("selectAssistantBundle remains deterministic for the flagship scenario", () => {
    const first = selectAssistantBundle(FLAGSHIP_SCENARIO_ID);
    const second = selectAssistantBundle(FLAGSHIP_SCENARIO_ID);
    expect(first.sort()).toEqual(second.sort());
    for (const key of first) {
      expect(ASSISTANT_ROSTER[key]).toBeDefined();
    }
  });
});
