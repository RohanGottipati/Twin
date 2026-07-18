import { describe, expect, it } from "vitest";

import { parseMapActions } from "@/lib/twinto/map-actions";

describe("parseMapActions", () => {
  it("accepts allowlisted fly_to_center and candidate markers", () => {
    const result = parseMapActions([
      { type: "fly_to_center", center: [-79.38, 43.65], zoom: 14, durationMs: 800 },
      {
        type: "show_candidate_markers",
        candidates: [
          { candidateId: "station-parkdale", coordinates: [-79.436, 43.6388], rank: 1, label: "Parkdale" },
        ],
      },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.actions).toHaveLength(2);
  });

  it("rejects arbitrary javascript-like payloads and out-of-range zoom", () => {
    const result = parseMapActions([
      { type: "eval", code: "alert(1)" },
      { type: "fly_to_center", center: [-79.38, 43.65], zoom: 99, durationMs: 800 },
    ]);
    expect(result.ok).toBe(false);
  });

  it("rejects coordinates outside the City of Toronto", () => {
    const result = parseMapActions([
      { type: "fly_to_center", center: [-123.12, 49.28], zoom: 12, durationMs: 800 },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => /outside the City of Toronto/i.test(error))).toBe(true);
    }
  });
});
