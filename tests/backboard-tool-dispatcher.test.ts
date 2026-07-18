import { beforeEach, describe, expect, it } from "vitest";

import { getBackboardAdapter, resetBackboardAdapterForTests } from "@/lib/backboard/adapter";
import type { BackboardAdapter, ChatToolCall } from "@/lib/backboard/client";
import { createRunContext, dispatchToolCall, type RunContext } from "@/lib/backboard/tool-dispatcher";
import { requireAsset } from "@/lib/grid/fixtures";
import { resolveScenarioConditions } from "@/lib/grid/scenarios";
import type { ConditionHour, DispatchInterval, DispatchPlan } from "@/lib/grid/types";

const asset = requireAsset("ontario-bess-01");

function buildPlan(
  scenarioId: string,
  conditions: ConditionHour[],
  build: (condition: ConditionHour, index: number) => Partial<DispatchInterval>,
): DispatchPlan {
  const intervals: DispatchInterval[] = conditions.map((condition, index) => ({
    timestamp: condition.timestamp,
    chargeMw: 0,
    dischargeMw: 0,
    reserveMw: 0,
    rationale: "test interval",
    confidence: 0.6,
    ...build(condition, index),
  }));

  return {
    schemaVersion: 1,
    assetId: asset.id,
    scenarioId,
    horizonStart: conditions[0]?.timestamp ?? "",
    intervalMinutes: 60,
    strategy: "test-strategy",
    assumptions: [],
    warnings: [],
    intervals,
  };
}

function call(name: string, args: Record<string, unknown>): ChatToolCall {
  return { id: `call-${name}`, name, arguments: args, rawArguments: JSON.stringify(args) };
}

describe("dispatchToolCall", () => {
  let adapter: BackboardAdapter;
  let context: RunContext;

  beforeEach(() => {
    process.env.BACKBOARD_MOCK_MODE = "true";
    resetBackboardAdapterForTests();
    adapter = getBackboardAdapter();
    context = createRunContext(asset.id, "normal-day", adapter);
  });

  it("get_asset_spec returns the requested asset", async () => {
    const outcome = await dispatchToolCall(call("get_asset_spec", { assetId: asset.id }), context, "a1");
    expect(outcome.ok).toBe(true);
    expect((outcome.output as { id: string }).id).toBe(asset.id);
  });

  it("get_market_window never leaks hidden-stress data", async () => {
    const outcome = await dispatchToolCall(
      call("get_market_window", { assetId: asset.id, scenarioId: "demand-forecast-increase" }),
      context,
      "a1",
    );
    expect(outcome.ok).toBe(true);
    const envelope = outcome.output as { dataMode: string; data: { demandMw: number }[] };
    expect(envelope.dataMode).toBe("fixture");
    const conditions = resolveScenarioConditions("demand-forecast-increase", asset);
    expect(envelope.data[0].demandMw).toBe(conditions.visibleHours[0].demandMw);
    expect(envelope.data[0].demandMw).not.toBe(conditions.actualHours[0].demandMw);
  });

  it("get_renewable_forecast returns visible-only hours", async () => {
    const outcome = await dispatchToolCall(
      call("get_renewable_forecast", { assetId: asset.id, scenarioId: "renewable-forecast-miss" }),
      context,
      "a1",
    );
    expect(outcome.ok).toBe(true);
    const envelope = outcome.output as { data: { windMw: number }[] };
    const conditions = resolveScenarioConditions("renewable-forecast-miss", asset);
    expect(envelope.data[0].windMw).toBe(conditions.visibleHours[0].windMw);
  });

  it("get_similar_scenarios returns ranked historical records", async () => {
    const outcome = await dispatchToolCall(
      call("get_similar_scenarios", { scenarioType: "stress", limit: 2 }),
      context,
      "a1",
    );
    expect(outcome.ok).toBe(true);
    const { records } = outcome.output as { records: unknown[] };
    expect(records.length).toBeGreaterThan(0);
    expect(records.length).toBeLessThanOrEqual(2);
  });

  it("validate_dispatch_plan flags an idle plan as valid", async () => {
    const conditions = resolveScenarioConditions("normal-day", asset).visibleHours;
    const plan = buildPlan("normal-day", conditions, () => ({}));
    const outcome = await dispatchToolCall(
      call("validate_dispatch_plan", { assetId: asset.id, scenarioId: "normal-day", candidateId: "c1", plan }),
      context,
      "a1",
    );
    expect(outcome.ok).toBe(true);
    expect((outcome.output as { valid: boolean }).valid).toBe(true);
  });

  it("simulate_dispatch_plan records the result for later ranking", async () => {
    const conditions = resolveScenarioConditions("normal-day", asset).visibleHours;
    const plan = buildPlan("normal-day", conditions, () => ({}));
    const outcome = await dispatchToolCall(
      call("simulate_dispatch_plan", { assetId: asset.id, scenarioId: "normal-day", candidateId: "c1", plan }),
      context,
      "a1",
    );
    expect(outcome.ok).toBe(true);
    expect(context.simulationsByCandidateId.get("c1")?.visible).toBeDefined();
  });

  it("stress_test_dispatch_plan reveals reduced renewable capture under a forecast miss", async () => {
    const conditions = resolveScenarioConditions("renewable-forecast-miss", asset).visibleHours;
    const plan = buildPlan("renewable-forecast-miss", conditions, (_condition, index) =>
      index < 6 ? { chargeMw: 40 } : {},
    );
    const commonArgs = {
      assetId: asset.id,
      scenarioId: "renewable-forecast-miss",
      candidateId: "c-wind",
      plan,
    };
    const visibleOutcome = await dispatchToolCall(call("simulate_dispatch_plan", commonArgs), context, "a1");
    const stressOutcome = await dispatchToolCall(call("stress_test_dispatch_plan", commonArgs), context, "a1");

    expect(visibleOutcome.ok).toBe(true);
    expect(stressOutcome.ok).toBe(true);

    const visibleCapture = (visibleOutcome.output as { metrics: { renewableCapturedMwh: number } }).metrics
      .renewableCapturedMwh;
    const stressResult = stressOutcome.output as {
      metrics: { renewableCapturedMwh: number };
      hiddenStressDescription: string;
    };
    expect(stressResult.metrics.renewableCapturedMwh).toBeLessThan(visibleCapture);
    expect(stressResult.hiddenStressDescription).toContain("wind");
  });

  it("rank_dispatch_candidates ranks simulated candidates and disqualifies unsimulated ones as an error", async () => {
    const conditions = resolveScenarioConditions("normal-day", asset).visibleHours;
    const idlePlan = buildPlan("normal-day", conditions, () => ({}));
    const activePlan = buildPlan("normal-day", conditions, (_condition, index) =>
      index === 3 ? { chargeMw: 40 } : index === 18 ? { dischargeMw: 40 } : {},
    );

    await dispatchToolCall(
      call("simulate_dispatch_plan", { assetId: asset.id, scenarioId: "normal-day", candidateId: "idle", plan: idlePlan }),
      context,
      "a1",
    );
    await dispatchToolCall(
      call("simulate_dispatch_plan", {
        assetId: asset.id,
        scenarioId: "normal-day",
        candidateId: "active",
        plan: activePlan,
      }),
      context,
      "a1",
    );

    const rankOutcome = await dispatchToolCall(
      call("rank_dispatch_candidates", {
        assetId: asset.id,
        scenarioId: "normal-day",
        candidateIds: ["idle", "active"],
      }),
      context,
      "a1",
    );
    expect(rankOutcome.ok).toBe(true);
    const { ranked } = rankOutcome.output as { ranked: { candidateId: string }[] };
    expect(ranked.map((r) => r.candidateId).sort()).toEqual(["active", "idle"]);

    const badRankOutcome = await dispatchToolCall(
      call("rank_dispatch_candidates", {
        assetId: asset.id,
        scenarioId: "normal-day",
        candidateIds: ["idle", "never-simulated"],
      }),
      context,
      "a1",
    );
    expect(badRankOutcome.ok).toBe(false);
    expect((badRankOutcome.output as { error: string }).error).toContain("never-simulated");
  });

  it("recall_operator_notes searches this assistant's memory", async () => {
    await adapter.addMemory("a1", "Operator prefers conservative reserve margins during evening peaks.");
    const outcome = await dispatchToolCall(call("recall_operator_notes", { query: "reserve" }), context, "a1");
    expect(outcome.ok).toBe(true);
    const { memories } = outcome.output as { memories: { content: string }[] };
    expect(memories.length).toBe(1);
    expect(memories[0].content).toContain("conservative reserve margins");
  });

  it("returns a graceful error for malformed arguments instead of throwing", async () => {
    const outcome = await dispatchToolCall(call("get_asset_spec", {}), context, "a1");
    expect(outcome.ok).toBe(false);
    expect((outcome.output as { error: string }).error).toBeTruthy();
  });

  it("returns a graceful error for an unknown tool name", async () => {
    const outcome = await dispatchToolCall(call("delete_the_grid", {}), context, "a1");
    expect(outcome.ok).toBe(false);
    expect((outcome.output as { error: string }).error).toContain("Unknown tool");
  });
});
