import { afterEach, describe, expect, it, vi } from "vitest";

import { createSseResponse, createSseStream, encodeSseEvent, toTwinTORunEventEnvelope } from "@/lib/backboard/sse";
import { createRunStreamClient, parseSseChunk } from "@/lib/backboard/stream-parser";
import type { TwinTORunEvent } from "@/lib/backboard/orchestrator";
import { twinTORunEventEnvelopeSchema } from "@/lib/transit/schemas";

async function readAllText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

describe("encodeSseEvent", () => {
  it("emits a bare data line when no eventName is given", () => {
    const frame = encodeSseEvent(1, { hello: "world" });
    expect(frame).toBe(`data: ${JSON.stringify({ hello: "world" })}\n\n`);
    expect(frame).not.toContain("id:");
    expect(frame).not.toContain("event:");
  });

  it("emits id, event, and data lines when eventName is given", () => {
    const frame = encodeSseEvent("abc-1", { hello: "world" }, "custom.type");
    expect(frame).toBe(`id: abc-1\nevent: custom.type\ndata: ${JSON.stringify({ hello: "world" })}\n\n`);
  });
});

describe("createSseResponse", () => {
  it("sets the standard SSE headers", () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });
    const response = createSseResponse(stream);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(response.headers.get("Cache-Control")).toBe("no-cache");
    expect(response.headers.get("Connection")).toBe("keep-alive");
  });
});

describe("toTwinTORunEventEnvelope", () => {
  it("hoists type and runId to the envelope and carries the full TwinTO event verbatim as payload", () => {
    const event: TwinTORunEvent = {
      type: "simulation.completed",
      runId: "run-123",
      candidateId: "balanced-retime",
      summary: "meanWaitMinutes=3.20, deniedBoardings=0, valid=true",
    };
    const envelope = toTwinTORunEventEnvelope(event, 3);
    expect(envelope).toEqual({
      eventId: "run-123:3",
      runId: "run-123",
      sequence: 3,
      type: "simulation.completed",
      timestamp: expect.any(String),
      payload: {
        type: "simulation.completed",
        runId: "run-123",
        candidateId: "balanced-retime",
        summary: "meanWaitMinutes=3.20, deniedBoardings=0, valid=true",
      },
    });
    expect(twinTORunEventEnvelopeSchema.safeParse(envelope).success).toBe(true);
  });

  it("never carries a reasoning or thinking field in the payload for any TwinTO event", () => {
    const event: TwinTORunEvent = { type: "run.failed", runId: "run-456", error: "boom" };
    const envelope = toTwinTORunEventEnvelope(event, 1);
    expect(envelope.payload).not.toHaveProperty("reasoning");
    expect(envelope.payload).not.toHaveProperty("thinking");
    expect(twinTORunEventEnvelopeSchema.safeParse(envelope).success).toBe(true);
  });

  it("rejects an envelope whose payload smuggles a reasoning field, via the schema's own refinement", () => {
    const contaminated = {
      eventId: "r1:1",
      runId: "r1",
      sequence: 1,
      type: "agent.completed",
      timestamp: new Date().toISOString(),
      payload: { type: "agent.completed", runId: "r1", role: "safety", name: "Safety Agent", summary: "ok", reasoning: "leaked chain of thought" },
    };
    expect(twinTORunEventEnvelopeSchema.safeParse(contaminated).success).toBe(false);
  });
});

describe("createSseStream", () => {
  it("streams every writer.send call and closes when the producer resolves", async () => {
    const stream = createSseStream(async (writer) => {
      writer.send({ type: "run.started", runId: "r1", scenarioId: "departure-406-412" });
      writer.send({ type: "run.completed", runId: "r1" });
    });

    const text = await readAllText(stream);
    const blocks = text.split("\n\n").filter((block) => block.length > 0);
    expect(blocks).toHaveLength(2);
    expect(JSON.parse(blocks[0].replace("data: ", ""))).toEqual({
      type: "run.started",
      runId: "r1",
      scenarioId: "departure-406-412",
    });
  });

  it("reports a producer error as one stream.error event instead of an unhandled rejection", async () => {
    const stream = createSseStream(async () => {
      throw new Error("orchestration exploded");
    });

    const text = await readAllText(stream);
    const [block] = text.split("\n\n").filter((entry) => entry.length > 0);
    const dataLine = block.split("\n").find((line) => line.startsWith("data:")) ?? "";
    const data = JSON.parse(dataLine.slice("data:".length).trim());
    expect(data.message).toBe("orchestration exploded");
  });

  it("stops accepting writes once the writer is closed", async () => {
    let sendAfterClose: (() => void) | undefined;
    const stream = createSseStream(async (writer) => {
      writer.send({ ok: 1 });
      writer.close();
      sendAfterClose = () => writer.send({ ok: 2 });
      sendAfterClose();
    });
    const text = await readAllText(stream);
    expect(text).toContain('{"ok":1}');
    expect(text).not.toContain('{"ok":2}');
  });
});

describe("parseSseChunk", () => {
  it("parses one complete block delivered in a single chunk", () => {
    const envelope = {
      eventId: "r1:1",
      runId: "r1",
      sequence: 1,
      type: "run.started",
      timestamp: new Date().toISOString(),
      payload: { scenarioId: "departure-406-412" },
    };
    const chunk = encodeSseEvent(1, envelope);
    const { events, remainder } = parseSseChunk("", chunk);
    expect(remainder).toBe("");
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(envelope);
  });

  it("reassembles a block split across two chunks", () => {
    const envelope = {
      eventId: "r1:1",
      runId: "r1",
      sequence: 1,
      type: "run.started",
      timestamp: new Date().toISOString(),
      payload: {},
    };
    const raw = encodeSseEvent(1, envelope);
    const splitPoint = Math.floor(raw.length / 2);

    const first = parseSseChunk("", raw.slice(0, splitPoint));
    expect(first.events).toHaveLength(0);

    const second = parseSseChunk(first.remainder, raw.slice(splitPoint));
    expect(second.events).toHaveLength(1);
    expect(second.events[0]).toEqual(envelope);
    expect(second.remainder).toBe("");
  });

  it("ignores a duplicate sequence number when the same seen set is reused", () => {
    const envelope = {
      eventId: "r1:1",
      runId: "r1",
      sequence: 1,
      type: "run.started",
      timestamp: new Date().toISOString(),
      payload: {},
    };
    const raw = encodeSseEvent(1, envelope);
    const seen = new Set<number>();

    const first = parseSseChunk("", raw, seen);
    expect(first.events).toHaveLength(1);

    const second = parseSseChunk(first.remainder, raw, seen);
    expect(second.events).toHaveLength(0);
  });

  it("silently drops a block that is not valid JSON or fails schema validation", () => {
    const malformed = "data: not json at all\n\n";
    const { events } = parseSseChunk("", malformed);
    expect(events).toHaveLength(0);

    const missingFields = `data: ${JSON.stringify({ type: "run.started" })}\n\n`;
    const { events: events2 } = parseSseChunk("", missingFields);
    expect(events2).toHaveLength(0);
  });

  it("drops a block whose payload carries a raw reasoning field", () => {
    const contaminated = {
      eventId: "r1:1",
      runId: "r1",
      sequence: 1,
      type: "agent.completed",
      timestamp: new Date().toISOString(),
      payload: { reasoning: "leaked" },
    };
    const { events } = parseSseChunk("", encodeSseEvent(1, contaminated));
    expect(events).toHaveLength(0);
  });
});

describe("createRunStreamClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function envelopeFor(sequence: number, type: string): unknown {
    return {
      eventId: `r1:${sequence}`,
      runId: "r1",
      sequence,
      type,
      timestamp: new Date().toISOString(),
      payload: {},
    };
  }

  it("streams validated events to onEvent and calls onDone once the body ends", async () => {
    const chunks = [
      encodeSseEvent(1, envelopeFor(1, "run.started")),
      encodeSseEvent(2, envelopeFor(2, "run.completed")),
    ];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(body, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const received: unknown[] = [];
    const done = new Promise<void>((resolve) => {
      createRunStreamClient({
        url: "http://localhost/api/backboard/run",
        body: { scenarioId: "departure-406-412" },
        onEvent: (event) => received.push(event),
        onDone: resolve,
        onError: (error) => {
          throw error;
        },
      });
    });

    await done;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(received).toHaveLength(2);
    expect((received[0] as { type: string }).type).toBe("run.started");
    expect((received[1] as { type: string }).type).toBe("run.completed");
  });

  it("calls onError, not onDone, when the response is not ok", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const error = await new Promise<Error>((resolve) => {
      createRunStreamClient({
        url: "http://localhost/api/backboard/run",
        body: {},
        onEvent: () => {
          throw new Error("should not receive events");
        },
        onError: resolve,
      });
    });
    expect(error.message).toContain("500");
  });

  it("calls onDone, not onError, when aborted", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const abortError = new Error("aborted");
          abortError.name = "AbortError";
          reject(abortError);
        });
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const done = new Promise<void>((resolve) => {
      createRunStreamClient({
        url: "http://localhost/api/backboard/run",
        body: {},
        signal: controller.signal,
        onEvent: () => {
          throw new Error("should not receive events");
        },
        onError: () => {
          throw new Error("should not error on a deliberate abort");
        },
        onDone: resolve,
      });
    });

    controller.abort();
    await done;
  });
});
