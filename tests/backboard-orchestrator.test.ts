import { beforeEach, describe, expect, it } from "vitest";

import { resetAssistantManifestForTests } from "@/lib/backboard/assistant-manifest";
import { ASSISTANT_ROSTER } from "@/lib/backboard/assistants";
import { mockAssistantId, MockBackboardAdapter, type MockSendMessageHints } from "@/lib/backboard/mock-adapter";
import { runGridTwinOrchestration, type GridRunEvent } from "@/lib/backboard/orchestrator";
import { requireAsset } from "@/lib/grid/fixtures";
import type { AnalystFinding, DispatchPlanParsed, FinalRecommendation, RiskReview } from "@/lib/grid/schemas";
import { resolveScenarioConditions } from "@/lib/grid/scenarios";
import type { ConditionHour, DispatchInterval } from "@/lib/grid/types";

const ASSET_ID = "ontario-bess-01";
const SCENARIO_ID = "normal-day";

function roleAssistantId(role: keyof typeof ASSISTANT_ROSTER): string {
  return mockAssistantId(ASSISTANT_ROSTER[role].name);
}

function buildPlan(
  candidateId: string,
  visibleHours: ConditionHour[],
  overrides: (hour: ConditionHour) => Partial<DispatchInterval> = () => ({}),
): DispatchPlanParsed {
  return {
    schemaVersion: 1,
    assetId: ASSET_ID,
    scenarioId: SCENARIO_ID,
    horizonStart: visibleHours[0].timestamp,
    intervalMinutes: 60,
    strategy: candidateId,
    assumptions: [],
    warnings: [],
    intervals: visibleHours.map((hour) => ({
      timestamp: hour.timestamp,
      chargeMw: 0,
      dischargeMw: 0,
      reserveMw: 20,
      rationale: "hold",
      confidence: 0.5,
      ...overrides(hour),
    })),
  };
}

function analystFinding(role: string, headline: string): AnalystFinding {
  return { role, headline, summary: `${headline} summary.`, keySignals: ["signal-a"], confidence: 0.7 };
}

function scriptAnalysts(adapter: MockBackboardAdapter): void {
  adapter.scriptAssistantResponses(roleAssistantId("market-analyst"), [
    { mockJsonResponse: analystFinding("market-analyst", "Cheapest hours are overnight.") },
  ]);
  adapter.scriptAssistantResponses(roleAssistantId("renewable-analyst"), [
    { mockJsonResponse: analystFinding("renewable-analyst", "Moderate wind, no thermal risk.") },
  ]);
}

function reviewFor(candidateId: string): RiskReview {
  return {
    candidateId,
    riskLevel: "low",
    summary: `${candidateId} passed validation and simulation.`,
    concerns: [],
    recommendation: "approve",
  };
}

describe("runGridTwinOrchestration", () => {
  let asset: ReturnType<typeof requireAsset>;
  let visibleHours: ConditionHour[];

  beforeEach(() => {
    process.env.BACKBOARD_MOCK_MODE = "true";
    resetAssistantManifestForTests();
    asset = requireAsset(ASSET_ID);
    visibleHours = resolveScenarioConditions(SCENARIO_ID, asset).visibleHours;
  });

  it("runs the full pipeline and produces a deterministic ranking plus a valid recommendation", async () => {
    const adapter = new MockBackboardAdapter();
    scriptAnalysts(adapter);

    const conservativePlan = buildPlan("conservative", visibleHours);
    const balancedPlan = buildPlan("balanced", visibleHours, (hour) =>
      hour.hour >= 12 && hour.hour < 22 ? { dischargeMw: 5, rationale: "discharge into demand" } : {},
    );

    adapter.scriptAssistantResponses(roleAssistantId("dispatch-planner"), [
      { mockJsonResponse: { candidates: [{ candidateId: "conservative", plan: conservativePlan }, { candidateId: "balanced", plan: balancedPlan }] } },
    ]);

    const reviewerHints: MockSendMessageHints = {
      mockToolPlan: [
        [
          { name: "validate_dispatch_plan", arguments: { assetId: ASSET_ID, scenarioId: SCENARIO_ID, candidateId: "conservative", plan: conservativePlan } },
          { name: "simulate_dispatch_plan", arguments: { assetId: ASSET_ID, scenarioId: SCENARIO_ID, candidateId: "conservative", plan: conservativePlan } },
          { name: "validate_dispatch_plan", arguments: { assetId: ASSET_ID, scenarioId: SCENARIO_ID, candidateId: "balanced", plan: balancedPlan } },
          { name: "simulate_dispatch_plan", arguments: { assetId: ASSET_ID, scenarioId: SCENARIO_ID, candidateId: "balanced", plan: balancedPlan } },
        ],
        [
          { name: "stress_test_dispatch_plan", arguments: { assetId: ASSET_ID, scenarioId: SCENARIO_ID, candidateId: "conservative", plan: conservativePlan } },
          { name: "stress_test_dispatch_plan", arguments: { assetId: ASSET_ID, scenarioId: SCENARIO_ID, candidateId: "balanced", plan: balancedPlan } },
        ],
        [{ name: "rank_dispatch_candidates", arguments: { assetId: ASSET_ID, scenarioId: SCENARIO_ID, candidateIds: ["conservative", "balanced"] } }],
      ],
      mockJsonResponse: { reviews: [reviewFor("conservative"), reviewFor("balanced")] },
    };
    adapter.scriptAssistantResponses(roleAssistantId("risk-reviewer"), [reviewerHints]);

    const chiefRecommendation: FinalRecommendation = {
      chosenCandidateId: "balanced",
      headline: "Discharge into demand hours.",
      reasoning: "Balanced candidate is valid and adds net value over idle.",
      tradeoffs: [],
      confidence: 0.8,
      recommendedAction: "approve",
    };
    adapter.scriptAssistantResponses(roleAssistantId("chief-dispatch-officer"), [{ mockJsonResponse: chiefRecommendation }]);

    const events: GridRunEvent[] = [];
    const result = await runGridTwinOrchestration({
      assetId: ASSET_ID,
      scenarioId: SCENARIO_ID,
      adapter,
      onEvent: (event) => events.push(event),
    });

    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.every((c) => c.simulationSource === "agent")).toBe(true);
    expect(result.candidates.every((c) => c.stressSimulationSource === "agent")).toBe(true);
    expect(result.ranking.every((r) => !r.disqualified)).toBe(true);
    expect(result.ranking.find((r) => r.candidateId === "balanced")?.rank).toBe(1);
    expect(result.rankDisagreement).toBe(false);
    expect(result.recommendationOverridden).toBe(false);
    expect(result.effectiveRecommendation.chosenCandidateId).toBe("balanced");
    expect(result.aiRecommendation).toEqual(chiefRecommendation);
    expect(result.chiefThreadId).toBeTruthy();

    const eventTypes = events.map((event) => event.type);
    expect(eventTypes[0]).toBe("run.created");
    expect(eventTypes).toContain("candidates.ranked");
    expect(eventTypes).toContain("recommendation.ready");
    expect(eventTypes.at(-1)).toBe("run.completed");
  });

  it("overrides the recommendation when the chief chooses a disqualified candidate", async () => {
    const adapter = new MockBackboardAdapter();
    scriptAnalysts(adapter);

    const conservativePlan = buildPlan("conservative", visibleHours);
    const aggressivePlan = buildPlan("aggressive", visibleHours, (hour) => (hour.hour === 0 ? { chargeMw: 150 } : {}));

    adapter.scriptAssistantResponses(roleAssistantId("dispatch-planner"), [
      { mockJsonResponse: { candidates: [{ candidateId: "conservative", plan: conservativePlan }, { candidateId: "aggressive", plan: aggressivePlan }] } },
    ]);

    adapter.scriptAssistantResponses(roleAssistantId("risk-reviewer"), [
      {
        mockToolPlan: [
          [
            { name: "validate_dispatch_plan", arguments: { assetId: ASSET_ID, scenarioId: SCENARIO_ID, candidateId: "conservative", plan: conservativePlan } },
            { name: "simulate_dispatch_plan", arguments: { assetId: ASSET_ID, scenarioId: SCENARIO_ID, candidateId: "conservative", plan: conservativePlan } },
            { name: "validate_dispatch_plan", arguments: { assetId: ASSET_ID, scenarioId: SCENARIO_ID, candidateId: "aggressive", plan: aggressivePlan } },
            { name: "simulate_dispatch_plan", arguments: { assetId: ASSET_ID, scenarioId: SCENARIO_ID, candidateId: "aggressive", plan: aggressivePlan } },
          ],
          [
            { name: "stress_test_dispatch_plan", arguments: { assetId: ASSET_ID, scenarioId: SCENARIO_ID, candidateId: "conservative", plan: conservativePlan } },
            { name: "stress_test_dispatch_plan", arguments: { assetId: ASSET_ID, scenarioId: SCENARIO_ID, candidateId: "aggressive", plan: aggressivePlan } },
          ],
          [{ name: "rank_dispatch_candidates", arguments: { assetId: ASSET_ID, scenarioId: SCENARIO_ID, candidateIds: ["conservative", "aggressive"] } }],
        ],
        mockJsonResponse: {
          reviews: [
            reviewFor("conservative"),
            { candidateId: "aggressive", riskLevel: "high", summary: "Exceeds charge limit.", concerns: ["charge-exceeds-limit"], recommendation: "reject" },
          ],
        },
      },
    ]);

    const badRecommendation: FinalRecommendation = {
      chosenCandidateId: "aggressive",
      headline: "Chase maximum charge.",
      reasoning: "Ignoring the violation.",
      tradeoffs: [],
      confidence: 0.9,
      recommendedAction: "approve",
    };
    adapter.scriptAssistantResponses(roleAssistantId("chief-dispatch-officer"), [{ mockJsonResponse: badRecommendation }]);

    const result = await runGridTwinOrchestration({ assetId: ASSET_ID, scenarioId: SCENARIO_ID, adapter });

    const aggressiveRank = result.ranking.find((r) => r.candidateId === "aggressive");
    expect(aggressiveRank?.disqualified).toBe(true);
    expect(result.aiRecommendation.chosenCandidateId).toBe("aggressive");
    expect(result.recommendationOverridden).toBe(true);
    expect(result.overrideReason).toMatch(/aggressive/);
    expect(result.effectiveRecommendation.chosenCandidateId).toBe("conservative");
    expect(result.effectiveRecommendation.recommendedAction).toBe("hold_for_operator");
  });

  it("falls back to local simulation when the risk reviewer forgets to simulate a candidate", async () => {
    const adapter = new MockBackboardAdapter();
    scriptAnalysts(adapter);

    const conservativePlan = buildPlan("conservative", visibleHours);
    const balancedPlan = buildPlan("balanced", visibleHours, (hour) =>
      hour.hour >= 12 && hour.hour < 22 ? { dischargeMw: 5 } : {},
    );

    adapter.scriptAssistantResponses(roleAssistantId("dispatch-planner"), [
      { mockJsonResponse: { candidates: [{ candidateId: "conservative", plan: conservativePlan }, { candidateId: "balanced", plan: balancedPlan }] } },
    ]);

    // Reviewer only simulates "conservative" and never touches "balanced".
    adapter.scriptAssistantResponses(roleAssistantId("risk-reviewer"), [
      {
        mockToolPlan: [
          [
            { name: "validate_dispatch_plan", arguments: { assetId: ASSET_ID, scenarioId: SCENARIO_ID, candidateId: "conservative", plan: conservativePlan } },
            { name: "simulate_dispatch_plan", arguments: { assetId: ASSET_ID, scenarioId: SCENARIO_ID, candidateId: "conservative", plan: conservativePlan } },
          ],
          [
            { name: "stress_test_dispatch_plan", arguments: { assetId: ASSET_ID, scenarioId: SCENARIO_ID, candidateId: "conservative", plan: conservativePlan } },
          ],
        ],
        mockJsonResponse: { reviews: [reviewFor("conservative"), reviewFor("balanced")] },
      },
    ]);

    adapter.scriptAssistantResponses(roleAssistantId("chief-dispatch-officer"), [
      {
        mockJsonResponse: {
          chosenCandidateId: "balanced",
          headline: "Balanced plan.",
          reasoning: "Best net value.",
          tradeoffs: [],
          confidence: 0.7,
          recommendedAction: "approve",
        },
      },
    ]);

    const result = await runGridTwinOrchestration({ assetId: ASSET_ID, scenarioId: SCENARIO_ID, adapter });

    const conservative = result.candidates.find((c) => c.candidateId === "conservative");
    const balanced = result.candidates.find((c) => c.candidateId === "balanced");
    expect(conservative?.simulationSource).toBe("agent");
    expect(conservative?.stressSimulationSource).toBe("agent");
    expect(balanced?.simulationSource).toBe("local_fallback");
    expect(balanced?.stressSimulationSource).toBe("local_fallback");
    expect(result.ranking).toHaveLength(2);
    expect(result.ranking.every((r) => !r.disqualified)).toBe(true);
  });

  it("retries an assistant once when its first structured response is invalid, then succeeds", async () => {
    const adapter = new MockBackboardAdapter();
    scriptAnalysts(adapter);

    const conservativePlan = buildPlan("conservative", visibleHours);
    const balancedPlan = buildPlan("balanced", visibleHours);

    adapter.scriptAssistantResponses(roleAssistantId("dispatch-planner"), [
      { mockContent: "this is not json" },
      { mockJsonResponse: { candidates: [{ candidateId: "conservative", plan: conservativePlan }, { candidateId: "balanced", plan: balancedPlan }] } },
    ]);

    adapter.scriptAssistantResponses(roleAssistantId("risk-reviewer"), [
      {
        mockToolPlan: [
          [
            { name: "validate_dispatch_plan", arguments: { assetId: ASSET_ID, scenarioId: SCENARIO_ID, candidateId: "conservative", plan: conservativePlan } },
            { name: "simulate_dispatch_plan", arguments: { assetId: ASSET_ID, scenarioId: SCENARIO_ID, candidateId: "conservative", plan: conservativePlan } },
            { name: "validate_dispatch_plan", arguments: { assetId: ASSET_ID, scenarioId: SCENARIO_ID, candidateId: "balanced", plan: balancedPlan } },
            { name: "simulate_dispatch_plan", arguments: { assetId: ASSET_ID, scenarioId: SCENARIO_ID, candidateId: "balanced", plan: balancedPlan } },
          ],
        ],
        mockJsonResponse: { reviews: [reviewFor("conservative"), reviewFor("balanced")] },
      },
    ]);

    adapter.scriptAssistantResponses(roleAssistantId("chief-dispatch-officer"), [
      {
        mockJsonResponse: {
          chosenCandidateId: "conservative",
          headline: "Idle is safest.",
          reasoning: "No violations, simplest plan.",
          tradeoffs: [],
          confidence: 0.6,
          recommendedAction: "approve",
        },
      },
    ]);

    const result = await runGridTwinOrchestration({ assetId: ASSET_ID, scenarioId: SCENARIO_ID, adapter });
    expect(result.candidates).toHaveLength(2);
    expect(result.effectiveRecommendation.chosenCandidateId).toBe("conservative");
  });

  it("flags a rank disagreement without overriding when the chief picks a valid but non-top-ranked candidate", async () => {
    const adapter = new MockBackboardAdapter();
    scriptAnalysts(adapter);

    const conservativePlan = buildPlan("conservative", visibleHours);
    const balancedPlan = buildPlan("balanced", visibleHours, (hour) =>
      hour.hour >= 12 && hour.hour < 22 ? { dischargeMw: 5 } : {},
    );

    adapter.scriptAssistantResponses(roleAssistantId("dispatch-planner"), [
      { mockJsonResponse: { candidates: [{ candidateId: "conservative", plan: conservativePlan }, { candidateId: "balanced", plan: balancedPlan }] } },
    ]);

    adapter.scriptAssistantResponses(roleAssistantId("risk-reviewer"), [
      {
        mockToolPlan: [
          [
            { name: "validate_dispatch_plan", arguments: { assetId: ASSET_ID, scenarioId: SCENARIO_ID, candidateId: "conservative", plan: conservativePlan } },
            { name: "simulate_dispatch_plan", arguments: { assetId: ASSET_ID, scenarioId: SCENARIO_ID, candidateId: "conservative", plan: conservativePlan } },
            { name: "validate_dispatch_plan", arguments: { assetId: ASSET_ID, scenarioId: SCENARIO_ID, candidateId: "balanced", plan: balancedPlan } },
            { name: "simulate_dispatch_plan", arguments: { assetId: ASSET_ID, scenarioId: SCENARIO_ID, candidateId: "balanced", plan: balancedPlan } },
          ],
        ],
        mockJsonResponse: { reviews: [reviewFor("conservative"), reviewFor("balanced")] },
      },
    ]);

    // "balanced" outranks "conservative" on net value (see test 1), but the chief prefers the lower-ranked one for a documented reason.
    adapter.scriptAssistantResponses(roleAssistantId("chief-dispatch-officer"), [
      {
        mockJsonResponse: {
          chosenCandidateId: "conservative",
          headline: "Prefer the idle plan despite lower net value.",
          reasoning: "Documented preference for zero cycling this run.",
          tradeoffs: ["Forgoes some net value versus balanced."],
          confidence: 0.55,
          recommendedAction: "approve_with_monitoring",
        },
      },
    ]);

    const result = await runGridTwinOrchestration({ assetId: ASSET_ID, scenarioId: SCENARIO_ID, adapter });

    expect(result.ranking.find((r) => r.candidateId === "balanced")?.rank).toBe(1);
    expect(result.recommendationOverridden).toBe(false);
    expect(result.rankDisagreement).toBe(true);
    expect(result.effectiveRecommendation.chosenCandidateId).toBe("conservative");
  });
});
