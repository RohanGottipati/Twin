import { beforeEach, describe, expect, it } from "vitest";

import { parseSseChunk } from "@/lib/backboard/stream-parser";
import type { TwinTORunEventEnvelope } from "@/lib/transit/schemas";
import { FLAGSHIP_SCENARIO_ID } from "@/data/transit/scenarios";

function jsonRequest(body: unknown, signal?: AbortSignal): Request {
  return new Request("http://localhost/api/backboard/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

async function collectEnvelopes(response: Response): Promise<TwinTORunEventEnvelope[]> {
  if (!response.body) return [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const seen = new Set<number>();
  const events: TwinTORunEventEnvelope[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    const parsed = parseSseChunk(buffer, chunk, seen);
    buffer = parsed.remainder;
    events.push(...parsed.events);
  }
  return events;
}

describe("POST /api/backboard/run", () => {
  beforeEach(async () => {
    process.env.BACKBOARD_MOCK_MODE = "true";
    const { resetBackboardAdapterForTests } = await import("@/lib/backboard/adapter");
    const { resetAssistantManifestForTests } = await import("@/lib/backboard/assistant-manifest");
    const { resetRunRateLimiterForTests } = await import("@/lib/backboard/run-rate-limit");
    resetBackboardAdapterForTests();
    resetAssistantManifestForTests();
    resetRunRateLimiterForTests();
  });

  it("streams the full run lifecycle as validated SSE envelopes and completes, with no assetId required", async () => {
    const { POST } = await import("@/app/api/backboard/run/route");
    const response = await POST(jsonRequest({ scenarioId: FLAGSHIP_SCENARIO_ID }));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");

    const events = await collectEnvelopes(response);
    const types = events.map((event) => event.type);

    expect(types[0]).toBe("run.started");
    expect(types).toContain("recommendation.ready");
    expect(types.at(-1)).toBe("run.completed");

    const runIds = new Set(events.map((event) => event.runId));
    expect(runIds.size).toBe(1);

    const sequences = events.map((event) => event.sequence);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
    expect(new Set(sequences).size).toBe(sequences.length);

    for (const event of events) {
      expect(event.payload).not.toHaveProperty("reasoning");
      expect(event.payload).not.toHaveProperty("thinking");
    }
  }, 30_000);

  it("rejects a request missing scenarioId with 400", async () => {
    const { POST } = await import("@/app/api/backboard/run/route");
    const response = await POST(jsonRequest({}));
    expect(response.status).toBe(400);
  });

  it("rejects an unknown scenarioId with 404", async () => {
    const { POST } = await import("@/app/api/backboard/run/route");
    const response = await POST(jsonRequest({ scenarioId: "not-a-real-scenario" }));
    expect(response.status).toBe(404);
  });

  it("rate-limits repeated requests from the same client", async () => {
    const { POST } = await import("@/app/api/backboard/run/route");
    let lastStatus = 0;
    for (let i = 0; i < 25; i += 1) {
      const response = await POST(jsonRequest({ scenarioId: "not-a-real-scenario" }));
      lastStatus = response.status;
      if (lastStatus === 429) break;
    }
    expect(lastStatus).toBe(429);
  });

  it("stops emitting further events once the request is aborted", async () => {
    const controller = new AbortController();
    const { POST } = await import("@/app/api/backboard/run/route");
    const response = await POST(jsonRequest({ scenarioId: FLAGSHIP_SCENARIO_ID }, controller.signal));

    controller.abort();
    const events = await collectEnvelopes(response);
    const types = events.map((event) => event.type);
    expect(types.at(-1)).not.toBe("run.completed");
  }, 30_000);
});
