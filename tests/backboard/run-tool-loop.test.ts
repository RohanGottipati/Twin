import { beforeEach, describe, expect, it } from "vitest";

import { resetBackboardAdapterForTests } from "@/lib/backboard/adapter";
import { MockBackboardAdapter } from "@/lib/backboard/mock-adapter";
import { runToolLoop, RunToolLoopError } from "@/lib/backboard/run-tool-loop";
import { createRunContext } from "@/lib/backboard/tool-dispatcher";
import { TOOL_NAMES } from "@/lib/backboard/tools";
import { FLAGSHIP_SCENARIO_ID, requireScenario } from "@/data/transit/scenarios";

const scenario = requireScenario(FLAGSHIP_SCENARIO_ID);

describe("runToolLoop", () => {
  beforeEach(() => {
    process.env.BACKBOARD_MOCK_MODE = "true";
    resetBackboardAdapterForTests();
  });

  it("executes a parallel round then a chained round against the real transit domain", async () => {
    const adapter = new MockBackboardAdapter();
    const context = createRunContext(scenario.id, adapter);
    const startedCalls: string[] = [];
    const endedCalls: string[] = [];

    const result = await runToolLoop({
      adapter,
      assistantId: "baseline-analyst",
      content: "Analyze the flagship scenario.",
      context,
      metadata: {
        mockToolPlan: [
          [
            { name: TOOL_NAMES.GET_ROUTE_SCHEDULE, arguments: { routeId: scenario.routeId, scenarioId: scenario.id } },
            { name: TOOL_NAMES.GET_PASSENGER_ARRIVALS, arguments: { scenarioId: scenario.id } },
          ],
          [{ name: TOOL_NAMES.FIND_SIMILAR, arguments: { limit: 2 } }],
        ],
        mockContent: "The 16:06 departure is the bottleneck.",
      },
      onToolCallStart: (call) => startedCalls.push(call.name),
      onToolCallEnd: (outcome) => endedCalls.push(outcome.toolName),
    });

    expect(result.rounds).toBe(2);
    expect(result.finalResult.status).toBe("completed");
    expect(result.finalResult.content).toBe("The 16:06 departure is the bottleneck.");
    expect(startedCalls).toEqual([TOOL_NAMES.GET_ROUTE_SCHEDULE, TOOL_NAMES.GET_PASSENGER_ARRIVALS, TOOL_NAMES.FIND_SIMILAR]);
    expect(endedCalls.sort()).toEqual([TOOL_NAMES.GET_ROUTE_SCHEDULE, TOOL_NAMES.GET_PASSENGER_ARRIVALS, TOOL_NAMES.FIND_SIMILAR].sort());
    expect(result.toolCallLog).toHaveLength(3);
    expect(result.toolCallLog.every((outcome) => outcome.ok)).toBe(true);
  });

  it("feeds a tool error back as an output instead of throwing, and keeps going", async () => {
    const adapter = new MockBackboardAdapter();
    const context = createRunContext(scenario.id, adapter);

    const result = await runToolLoop({
      adapter,
      assistantId: "intervention-generator",
      content: "Propose a plan.",
      context,
      metadata: {
        mockToolPlan: [[{ name: TOOL_NAMES.GET_ROUTE_SCHEDULE, arguments: {} }]],
        mockContent: "Proceeding despite the missing routeId.",
      },
    });

    expect(result.toolCallLog[0].ok).toBe(false);
    expect(result.finalResult.status).toBe("completed");
  });

  it("throws RunToolLoopError when the round count exceeds maxRounds", async () => {
    const adapter = new MockBackboardAdapter();
    const context = createRunContext(scenario.id, adapter);

    await expect(
      runToolLoop({
        adapter,
        assistantId: "evidence-auditor",
        content: "Audit the candidates.",
        context,
        maxRounds: 1,
        metadata: {
          mockToolPlan: [
            [{ name: TOOL_NAMES.GET_NETWORK_SNAPSHOT, arguments: {} }],
            [{ name: TOOL_NAMES.GET_NETWORK_SNAPSHOT, arguments: {} }],
            [{ name: TOOL_NAMES.GET_NETWORK_SNAPSHOT, arguments: {} }],
          ],
          mockContent: "done",
        },
      }),
    ).rejects.toThrow(RunToolLoopError);
  });

  it("respects the default maxRounds of 8 when none is supplied", async () => {
    const adapter = new MockBackboardAdapter();
    const context = createRunContext(scenario.id, adapter);

    // Exactly 8 tool-call rounds, then a completion: should succeed under the default cap.
    const eightRounds = Array.from({ length: 8 }, () => [{ name: TOOL_NAMES.GET_NETWORK_SNAPSHOT, arguments: {} }]);
    const result = await runToolLoop({
      adapter,
      assistantId: "debate-moderator",
      content: "Moderate the debate.",
      context,
      metadata: { mockToolPlan: eightRounds, mockContent: "resolved" },
    });
    expect(result.rounds).toBe(8);
    expect(result.finalResult.status).toBe("completed");

    // One more round than the default cap allows should now throw.
    const nineRounds = Array.from({ length: 9 }, () => [{ name: TOOL_NAMES.GET_NETWORK_SNAPSHOT, arguments: {} }]);
    await expect(
      runToolLoop({
        adapter,
        assistantId: "debate-moderator-2",
        content: "Moderate the debate.",
        context,
        metadata: { mockToolPlan: nineRounds, mockContent: "resolved" },
      }),
    ).rejects.toThrow(RunToolLoopError);
  });
});
