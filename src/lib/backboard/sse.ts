import type { TechTORunEvent } from "@/lib/backboard/orchestrator";
import type { TechTORunEventEnvelope } from "@/lib/transit/schemas";

/**
 * Encodes one Server-Sent Event. With only (eventId, data) supplied, this
 * emits a bare `data:` line, matching what a simple heartbeat or comment
 * frame needs. Once an eventName is also supplied, an `id:` and `event:`
 * line are added so browser EventSource listeners can filter by type and
 * clients can resume from the last seen id.
 */
export function encodeSseEvent(eventId: string | number, data: unknown, eventName?: string): string {
  const lines: string[] = [];
  if (eventName) {
    lines.push(`id: ${eventId}`);
    lines.push(`event: ${eventName}`);
  }
  lines.push(`data: ${JSON.stringify(data)}`);
  return `${lines.join("\n")}\n\n`;
}

const SSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
};

export function createSseResponse(stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, { headers: SSE_HEADERS });
}

/**
 * Maps one internal TechTORunEvent to the frontend-safe envelope every
 * Backboard SSE route sends over the wire. TechTORunEvent is already coarse
 * (agent/tool lifecycle and transit-domain evidence only, see
 * orchestrator.ts), so this is a reshape, not a redaction pass. `payload`
 * carries the event verbatim (type and runId included) rather than a
 * stripped-down remainder, since consumers (see
 * src/lib/techto/use-backboard-run.ts) are written against
 * `envelope.payload` being a complete TechTORunEvent on its own; the outer
 * eventId/runId/sequence/type/timestamp fields are stream bookkeeping
 * layered on top, not a replacement for them.
 */
export function toTechTORunEventEnvelope(event: TechTORunEvent, sequence: number): TechTORunEventEnvelope {
  return {
    eventId: `${event.runId}:${sequence}`,
    runId: event.runId,
    sequence,
    type: event.type,
    timestamp: new Date().toISOString(),
    payload: { ...event },
  };
}

export interface SseWriter {
  /** Encodes and enqueues one event. No-op once the stream has closed or the client disconnected. */
  send(data: unknown, eventName?: string): void;
  /** Idempotent; safe to call more than once. */
  close(): void;
  readonly closed: boolean;
}

/**
 * Wires a producer function up to a ReadableStream of SSE bytes. The
 * producer receives a writer with an auto-incrementing sequence number per
 * `send` call, and the stream is closed automatically when the producer
 * settles (success or failure) or when the consumer disconnects (cancel).
 * Any error thrown by the producer is reported as one `stream.error` event
 * before closing, rather than left as an unhandled rejection.
 */
export function createSseStream(
  produce: (writer: SseWriter) => Promise<void>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let sequence = 0;
  let closed = false;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const writer: SseWriter = {
        get closed() {
          return closed;
        },
        send(data, eventName) {
          if (closed) return;
          sequence += 1;
          try {
            controller.enqueue(encoder.encode(encodeSseEvent(sequence, data, eventName)));
          } catch {
            closed = true;
          }
        },
        close() {
          if (closed) return;
          closed = true;
          try {
            controller.close();
          } catch {
            // Already closed by the consumer disconnecting; nothing to do.
          }
        },
      };

      try {
        await produce(writer);
      } catch (error) {
        writer.send(
          { message: error instanceof Error ? error.message : String(error) },
          "stream.error",
        );
      } finally {
        writer.close();
      }
    },
    cancel() {
      closed = true;
    },
  });
}
