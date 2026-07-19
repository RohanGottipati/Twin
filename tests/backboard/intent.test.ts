import { describe, expect, it } from "vitest";

import { selectAssistantsForIntent } from "@/lib/backboard/assistants";
import { classifyPlanningIntent } from "@/lib/techto/intent";

describe("classifyPlanningIntent", () => {
  it("falls back safely for unknown free text to an open city planning path", () => {
    expect(classifyPlanningIntent("tell me something useful about transit")).toBe("OPEN_CITY_ASK");
  });

  it("keeps simple explanation bundles small", () => {
    expect(selectAssistantsForIntent(classifyPlanningIntent("What does load imbalance mean?")).length).toBeLessThanOrEqual(3);
  });
});
