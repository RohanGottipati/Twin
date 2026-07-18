import { beforeEach, describe, expect, it } from "vitest";

import { resetAssistantManifestForTests } from "@/lib/backboard/assistant-manifest";
import { clearModelRouterCacheForTests } from "@/lib/backboard/model-router";
import { MockBackboardAdapter } from "@/lib/backboard/mock-adapter";
import { MOCK_DEMO_CANDIDATE_IDS, prepareMockDemoRun } from "@/lib/backboard/mock-demo-run";
import { runTwinTOOrchestration, type TwinTORunEvent } from "@/lib/backboard/orchestrator";
import { FLAGSHIP_SCENARIO_ID } from "@/data/transit/scenarios";

describe("runTwinTOOrchestration (MockBackboardAdapter + prepareMockDemoRun)", () => {
  beforeEach(() => {
    process.env.BACKBOARD_MOCK_MODE = "true";
    resetAssistantManifestForTests();
    clearModelRouterCacheForTests();
  });

  it("completes the full pipeline, emits a recommendation, and involves at least 18 participating agents", async () => {
    const adapter = new MockBackboardAdapter();
    prepareMockDemoRun(adapter, FLAGSHIP_SCENARIO_ID);

    const events: TwinTORunEvent[] = [];
    const result = await runTwinTOOrchestration({
      scenarioId: FLAGSHIP_SCENARIO_ID,
      adapter,
      onEvent: (event) => events.push(event),
    });

    expect(result.scenarioId).toBe(FLAGSHIP_SCENARIO_ID);
    expect(result.candidates.length).toBeGreaterThanOrEqual(3);
    expect(result.simulations.length).toBe(result.candidates.length);
    expect(result.ranking.length).toBe(result.candidates.length);
    expect(result.aiRecommendation).toBeDefined();
    expect(result.effectiveRecommendation).toBeDefined();
    expect(result.participatingAgents.length).toBeGreaterThanOrEqual(18);
    expect(new Set(result.participatingAgents).size).toBe(result.participatingAgents.length);

    const eventTypes = events.map((event) => event.type);
    expect(eventTypes[0]).toBe("run.started");
    expect(eventTypes).toContain("recommendation.ready");
    expect(eventTypes).toContain("operator.ready");
    expect(eventTypes.at(-1)).toBe("run.completed");

    // No event payload ever carries raw reasoning/thinking (AGENTS.md 3.3).
    for (const event of events) {
      expect(event).not.toHaveProperty("reasoning");
      expect(event).not.toHaveProperty("thinking");
    }
  }, 30_000);

  it("disqualifies the intentionally unsafe overcapacity candidate via deterministic validation", async () => {
    const adapter = new MockBackboardAdapter();
    prepareMockDemoRun(adapter, FLAGSHIP_SCENARIO_ID);

    const result = await runTwinTOOrchestration({ scenarioId: FLAGSHIP_SCENARIO_ID, adapter });

    const unsafeRank = result.ranking.find((entry) => entry.interventionId === MOCK_DEMO_CANDIDATE_IDS.UNSAFE_OVERCAPACITY);
    expect(unsafeRank).toBeDefined();
    expect(unsafeRank?.disqualified).toBe(true);
    expect(result.effectiveRecommendation.chosenCandidateId).not.toBe(MOCK_DEMO_CANDIDATE_IDS.UNSAFE_OVERCAPACITY);
  }, 30_000);

  it("stress-tests every candidate against the flagship concert-surge overlay and can flag one as invalidated", async () => {
    const adapter = new MockBackboardAdapter();
    prepareMockDemoRun(adapter, FLAGSHIP_SCENARIO_ID);

    const result = await runTwinTOOrchestration({ scenarioId: FLAGSHIP_SCENARIO_ID, adapter });

    expect(result.stressResults.length).toBe(result.candidates.length);
    const unsafeStress = result.stressResults.find((entry) => entry.candidateId === MOCK_DEMO_CANDIDATE_IDS.UNSAFE_OVERCAPACITY);
    expect(unsafeStress?.result.invalidated).toBe(true);
  }, 30_000);

  it("produces citizen reactions for every candidate, each explicitly labeled as a simulated reading", async () => {
    const adapter = new MockBackboardAdapter();
    prepareMockDemoRun(adapter, FLAGSHIP_SCENARIO_ID);

    const result = await runTwinTOOrchestration({ scenarioId: FLAGSHIP_SCENARIO_ID, adapter });

    expect(result.citizenReactions.length).toBe(result.candidates.length);
    for (const entry of result.citizenReactions) {
      expect(entry.result.provider).toBe("mock");
    }
  }, 30_000);

  it("prefers the balanced-retime candidate the mock script recommends, subject to the deterministic final-authority check", async () => {
    const adapter = new MockBackboardAdapter();
    prepareMockDemoRun(adapter, FLAGSHIP_SCENARIO_ID);

    const result = await runTwinTOOrchestration({ scenarioId: FLAGSHIP_SCENARIO_ID, adapter });

    expect(result.aiRecommendation.chosenCandidateId).toBe(MOCK_DEMO_CANDIDATE_IDS.BALANCED_RETIME);
    const balancedRank = result.ranking.find((entry) => entry.interventionId === MOCK_DEMO_CANDIDATE_IDS.BALANCED_RETIME);
    expect(balancedRank?.disqualified).toBe(false);
  }, 30_000);
});
