import { describe, expect, it } from "vitest";

import { MockCitizenReactionProvider } from "@/lib/citizen-reaction/mock-provider";
import { getCitizenReactionProvider, getCitizenReactionProviderMode } from "@/lib/citizen-reaction/provider";
import type { CitizenReactionBatchInput } from "@/lib/citizen-reaction/schemas";

const BASE_COHORT = {
  cohortId: "downtown-commuters",
  label: "Downtown 9-to-5 commuters",
  populationWeight: 28,
  homeNeighborhood: "zone-liberty-village",
  demographics: { ageBand: "adult" as const, incomeBand: "middle" as const, primaryMode: "transit" as const, hasDisability: false },
};

const ACCESSIBILITY_COHORT = {
  cohortId: "accessibility-users",
  label: "Wheelchair and mobility-device users",
  populationWeight: 4,
  homeNeighborhood: "zone-regent-park",
  demographics: { ageBand: "adult" as const, incomeBand: "low" as const, primaryMode: "transit" as const, hasDisability: true },
};

function baseInput(overrides: Partial<CitizenReactionBatchInput> = {}): CitizenReactionBatchInput {
  return {
    scenarioId: "departure-406-412",
    intervention: { id: "retime", title: "Retime the 16:06 departure", description: "Shift later by 2 minutes.", category: "transit" },
    cohorts: [BASE_COHORT],
    context: { wait: { beforeMinutes: 6, afterMinutes: 6 } },
    ...overrides,
  };
}

describe("MockCitizenReactionProvider", () => {
  it("is deterministic: identical input always produces identical reactions", async () => {
    const provider = new MockCitizenReactionProvider();
    const input = baseInput();
    const first = await provider.predictBatch(input);
    const second = await provider.predictBatch(input);
    expect(second.reactions).toEqual(first.reactions);
    expect(second.aggregate).toEqual(first.aggregate);
  });

  it("produces a different reaction when the intervention id or cohort changes, even with the same context", async () => {
    const provider = new MockCitizenReactionProvider();
    const a = await provider.predictBatch(baseInput());
    const b = await provider.predictBatch(baseInput({ intervention: { id: "other", title: "A different plan", description: "Something else.", category: "transit" } }));
    expect(b.reactions[0].acceptance).not.toBe(a.reactions[0].acceptance);
  });

  it("reports its status as mock, never claiming to be a real or live model", async () => {
    const provider = new MockCitizenReactionProvider();
    const status = await provider.getStatus();
    expect(status.provider).toBe("mock");
    expect(status.mode).toBe("mock");
    expect(status.ready).toBe(true);
    expect(status.label.toLowerCase()).toContain("mock");
    expect(status.label.toLowerCase()).toMatch(/not real|not a trained/);
  });

  it("every batch result is explicitly labeled provider: mock", async () => {
    const provider = new MockCitizenReactionProvider();
    const result = await provider.predictBatch(baseInput());
    expect(result.provider).toBe("mock");
  });

  it("reacts to a worse wait-time delta by lowering acceptance relative to no change", async () => {
    const provider = new MockCitizenReactionProvider();
    const noChange = await provider.predictBatch(
      baseInput({ context: { wait: { beforeMinutes: 6, afterMinutes: 6 } } }),
    );
    const muchWorse = await provider.predictBatch(
      baseInput({ context: { wait: { beforeMinutes: 6, afterMinutes: 16 } } }),
    );
    expect(muchWorse.reactions[0].acceptance).toBeLessThan(noChange.reactions[0].acceptance);
    expect(muchWorse.reactions[0].rationale.toLowerCase()).toMatch(/wait/);
  });

  it("reacts to a worse crowding delta by lowering acceptance relative to no change", async () => {
    const provider = new MockCitizenReactionProvider();
    const noChange = await provider.predictBatch(
      baseInput({ context: { crowding: { beforeIndex: 0.3, afterIndex: 0.3 } } }),
    );
    const muchWorse = await provider.predictBatch(
      baseInput({ context: { crowding: { beforeIndex: 0.2, afterIndex: 0.95 } } }),
    );
    expect(muchWorse.reactions[0].acceptance).toBeLessThan(noChange.reactions[0].acceptance);
    expect(muchWorse.reactions[0].rationale.toLowerCase()).toMatch(/crowd/);
  });

  it("weighs an accessibility-sensitive cohort's acceptance more heavily off an accessibility delta", async () => {
    const provider = new MockCitizenReactionProvider();
    const worseAccess = { context: { accessibility: { beforeScore: 1, afterScore: 0 } } };
    const generalCohortResult = await provider.predictBatch(baseInput(worseAccess));
    const accessibilityCohortResult = await provider.predictBatch(
      baseInput({ ...worseAccess, cohorts: [ACCESSIBILITY_COHORT] }),
    );
    // Same context, but the accessibility-sensitive cohort should be pushed further from neutral.
    const generalDelta = Math.abs(generalCohortResult.reactions[0].acceptance - 0.5);
    const accessibilityDelta = Math.abs(accessibilityCohortResult.reactions[0].acceptance - 0.5);
    expect(accessibilityDelta).toBeGreaterThan(generalDelta);
  });

  it("aggregates population-weighted acceptance across multiple cohorts", async () => {
    const provider = new MockCitizenReactionProvider();
    const result = await provider.predictBatch(baseInput({ cohorts: [BASE_COHORT, ACCESSIBILITY_COHORT] }));
    expect(result.aggregate.cohortCount).toBe(2);
    expect(result.aggregate.populationWeightedAcceptance).toBeGreaterThanOrEqual(0);
    expect(result.aggregate.populationWeightedAcceptance).toBeLessThanOrEqual(1);
    expect(result.aggregate.acceptCount + result.aggregate.neutralCount + result.aggregate.rejectCount).toBe(2);
  });

  it("rejects malformed input via zod rather than producing a garbage reaction", async () => {
    const provider = new MockCitizenReactionProvider();
    await expect(
      provider.predictBatch({ ...baseInput(), cohorts: [] } as unknown as CitizenReactionBatchInput),
    ).rejects.toThrow();
  });
});

describe("getCitizenReactionProvider", () => {
  it("resolves to the mock provider by default", () => {
    expect(getCitizenReactionProviderMode()).toBe("mock");
    expect(getCitizenReactionProvider()).toBeInstanceOf(MockCitizenReactionProvider);
  });
});
