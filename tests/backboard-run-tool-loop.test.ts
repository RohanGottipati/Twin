import { beforeEach, describe, expect, it } from "vitest";

import { resetBackboardAdapterForTests } from "@/lib/backboard/adapter";
import { MockBackboardAdapter } from "@/lib/backboard/mock-adapter";
import { runToolLoop, RunToolLoopError } from "@/lib/backboard/run-tool-loop";
import { createRunContext } from "@/lib/backboard/tool-dispatcher";
import { requireAsset } from "@/lib/grid/fixtures";

const asset = requireAsset("ontario-bess-01");

describe("runToolLoop", () => {
  beforeEach(() => {
    process.env.BACKBOARD_MOCK_MODE = "true";
    resetBackboardAdapterForTests();
  });

  it("executes a parallel round then a chained round against the real grid domain", async () => {
    const adapter = new MockBackboardAdapter();
    const context = createRunContext(asset.id, "normal-day", adapter);
    const startedCalls: string[] = [];
    const endedCalls: string[] = [];

    const result = await runToolLoop({
      adapter,
      assistantId: "market-analyst",
      content: "Analyze the normal-day scenario.",
      context,
      metadata: {
        mockToolPlan: [
          [
            { name: "get_market_window", arguments: { assetId: asset.id, scenarioId: "normal-day" } },
            { name: "get_renewable_forecast", arguments: { assetId: asset.id, scenarioId: "normal-day" } },
          ],
          [{ name: "get_similar_scenarios", arguments: { scenarioType: "baseline" } }],
        ],
        mockContent: "The cheapest hour is early morning.",
      },
      onToolCallStart: (call) => startedCalls.push(call.name),
      onToolCallEnd: (outcome) => endedCalls.push(outcome.toolName),
    });

    expect(result.rounds).toBe(2);
    expect(result.finalResult.status).toBe("completed");
    expect(result.finalResult.content).toBe("The cheapest hour is early morning.");
    expect(startedCalls).toEqual(["get_market_window", "get_renewable_forecast", "get_similar_scenarios"]);
    expect(endedCalls.sort()).toEqual(["get_market_window", "get_renewable_forecast", "get_similar_scenarios"].sort());
    expect(result.toolCallLog).toHaveLength(3);
    expect(result.toolCallLog.every((outcome) => outcome.ok)).toBe(true);

    const marketOutcome = result.toolCallLog.find((o) => o.toolName === "get_market_window");
    const envelope = marketOutcome?.output as { dataMode: string };
    expect(envelope.dataMode).toBe("fixture");
  });

  it("feeds a tool error back as an output instead of throwing, and keeps going", async () => {
    const adapter = new MockBackboardAdapter();
    const context = createRunContext(asset.id, "normal-day", adapter);

    const result = await runToolLoop({
      adapter,
      assistantId: "dispatch-planner",
      content: "Propose a plan.",
      context,
      metadata: {
        mockToolPlan: [[{ name: "get_asset_spec", arguments: {} }]],
        mockContent: "Proceeding despite the missing assetId.",
      },
    });

    expect(result.toolCallLog[0].ok).toBe(false);
    expect(result.finalResult.status).toBe("completed");
  });

  it("throws RunToolLoopError when the round count exceeds maxRounds", async () => {
    const adapter = new MockBackboardAdapter();
    const context = createRunContext(asset.id, "normal-day", adapter);

    await expect(
      runToolLoop({
        adapter,
        assistantId: "risk-reviewer",
        content: "Review candidates.",
        context,
        maxRounds: 1,
        metadata: {
          mockToolPlan: [
            [{ name: "get_asset_spec", arguments: { assetId: asset.id } }],
            [{ name: "get_asset_spec", arguments: { assetId: asset.id } }],
            [{ name: "get_asset_spec", arguments: { assetId: asset.id } }],
          ],
          mockContent: "done",
        },
      }),
    ).rejects.toThrow(RunToolLoopError);
  });
});
