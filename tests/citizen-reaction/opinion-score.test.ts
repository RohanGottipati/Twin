import { describe, expect, it } from "vitest";

import { scoreOpinion } from "@/lib/citizen-reaction/opinion-score";

// Mirrors tests/test_scorer_placeholder.py 1:1 -- this TS port must stay in
// lockstep with model/scorer/placeholder.py.
describe("scoreOpinion", () => {
  it("scores a positive opinion above neutral", () => {
    const text = "I love this change, it's a great improvement and very convenient for my commute.";
    expect(scoreOpinion(text)).toBeGreaterThan(0.5);
  });

  it("scores a negative opinion below neutral", () => {
    const text = "I oppose this, it's an unfair and costly burden that will hurt local traffic.";
    expect(scoreOpinion(text)).toBeLessThan(0.5);
  });

  it("scores neutral or empty text at the midpoint", () => {
    expect(scoreOpinion("")).toBe(0.5);
    expect(scoreOpinion("The stop is located at the corner.")).toBe(0.5);
  });

  it("keeps the score bounded for extreme repeated word text", () => {
    const veryPositive = "great ".repeat(50);
    const veryNegative = "bad ".repeat(50);
    expect(scoreOpinion(veryPositive)).toBeGreaterThanOrEqual(0);
    expect(scoreOpinion(veryPositive)).toBeLessThanOrEqual(1);
    expect(scoreOpinion(veryNegative)).toBeGreaterThanOrEqual(0);
    expect(scoreOpinion(veryNegative)).toBeLessThanOrEqual(1);
  });

  it("flips polarity for negated sentiment within the negation window", () => {
    expect(scoreOpinion("This won't make much of a difference for me, honestly not great.")).toBeLessThan(0.5);
  });
});
