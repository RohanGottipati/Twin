import { describe, expect, it } from "vitest";

import { probeMetadata, scoreOpinionWithProbe } from "@/lib/citizen-reaction/bow-probe-score";

describe("scoreOpinionWithProbe", () => {
  it("returns a bounded score for real-looking opinion text", () => {
    const score = scoreOpinionWithProbe(
      "I support this plan, it would make things better for people like me in this neighbourhood.",
    );
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("returns neutral (0.5) for text with no vocabulary overlap", () => {
    expect(scoreOpinionWithProbe("")).toBe(0.5);
    expect(scoreOpinionWithProbe("Xqzv fjord mmm zzz")).toBe(0.5);
  });

  it("is deterministic for the same input", () => {
    const text = "This tax increase is unfair to working families and should be reconsidered.";
    expect(scoreOpinionWithProbe(text)).toBe(scoreOpinionWithProbe(text));
  });

  it("exposes the real training provenance (not synthetic)", () => {
    const meta = probeMetadata();
    expect(meta.nExamples).toBeGreaterThan(1000);
    expect(meta.valAuc).toBeGreaterThan(0.5);
  });
});
