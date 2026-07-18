import { describe, expect, it } from "vitest";
import { dispatchIntervalSchema, dispatchPlanSchema } from "@/lib/grid/schemas";

function validInterval() {
  return {
    timestamp: "2026-01-15T00:00:00.000Z",
    chargeMw: 10,
    dischargeMw: 0,
    reserveMw: 5,
    rationale: "Charging during a cheap overnight hour.",
    confidence: 0.7,
  };
}

describe("dispatchIntervalSchema", () => {
  it("accepts a well-formed interval", () => {
    expect(dispatchIntervalSchema.safeParse(validInterval()).success).toBe(true);
  });

  it("rejects simultaneous charge and discharge", () => {
    const result = dispatchIntervalSchema.safeParse({ ...validInterval(), dischargeMw: 10 });
    expect(result.success).toBe(false);
  });

  it("rejects non-finite numbers such as NaN or Infinity", () => {
    expect(dispatchIntervalSchema.safeParse({ ...validInterval(), chargeMw: Number.NaN }).success).toBe(false);
    expect(dispatchIntervalSchema.safeParse({ ...validInterval(), chargeMw: Number.POSITIVE_INFINITY }).success).toBe(false);
  });

  it("rejects confidence outside [0, 1]", () => {
    expect(dispatchIntervalSchema.safeParse({ ...validInterval(), confidence: 1.5 }).success).toBe(false);
    expect(dispatchIntervalSchema.safeParse({ ...validInterval(), confidence: -0.1 }).success).toBe(false);
  });

  it("rejects unknown fields", () => {
    const result = dispatchIntervalSchema.safeParse({ ...validInterval(), extraField: "smuggled" });
    expect(result.success).toBe(false);
  });

  it("rejects an empty rationale", () => {
    expect(dispatchIntervalSchema.safeParse({ ...validInterval(), rationale: "" }).success).toBe(false);
  });
});

describe("dispatchPlanSchema", () => {
  function validPlan() {
    return {
      schemaVersion: 1 as const,
      assetId: "ontario-bess-01",
      scenarioId: "normal-day",
      horizonStart: "2026-01-15T00:00:00.000Z",
      intervalMinutes: 60,
      strategy: "arbitrage",
      assumptions: [],
      warnings: [],
      intervals: [validInterval()],
    };
  }

  it("accepts a well-formed plan", () => {
    expect(dispatchPlanSchema.safeParse(validPlan()).success).toBe(true);
  });

  it("rejects a wrong schemaVersion", () => {
    expect(dispatchPlanSchema.safeParse({ ...validPlan(), schemaVersion: 2 }).success).toBe(false);
  });

  it("rejects a plan with zero intervals", () => {
    expect(dispatchPlanSchema.safeParse({ ...validPlan(), intervals: [] }).success).toBe(false);
  });

  it("rejects unknown top-level fields", () => {
    const result = dispatchPlanSchema.safeParse({ ...validPlan(), extra: true });
    expect(result.success).toBe(false);
  });

  it("defaults assumptions and warnings to empty arrays when omitted", () => {
    const { assumptions: _assumptions, warnings: _warnings, ...rest } = validPlan();
    const result = dispatchPlanSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.assumptions).toEqual([]);
      expect(result.data.warnings).toEqual([]);
    }
  });
});
