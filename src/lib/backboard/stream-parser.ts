/**
 * Client-safe SSE parsing and fetch-based streaming for Backboard run/
 * operator-question routes. Nothing here touches Node-only APIs (no fs, no
 * server env vars): it is imported from browser components as well as from
 * server-side tests, and only depends on the Web Streams / fetch globals and
 * the zod envelope schema, both of which are safe in either environment.
 */
import { techTORunEventEnvelopeSchema as backboardRunEventEnvelopeSchema, type TechTORunEventEnvelope as BackboardRunEventEnvelope } from "@/lib/transit/schemas";

export interface ParseSseChunkResult {
  events: BackboardRunEventEnvelope[];
  remainder: string;
}

/**
 * Consumes one more chunk of raw SSE bytes (already decoded to text) against
 * whatever was left over from the previous call, splitting on the blank-line
 * frame separator. Anything after the last blank line is incomplete and
 * handed back as `remainder` for the next call. `seen` is an optional,
 * caller-owned set of sequence numbers; when provided (see
 * createRunStreamClient) it is used to silently drop duplicate or replayed
 * events across calls, not just within one chunk.
 */
export function parseSseChunk(
  buffer: string,
  chunk: string,
  seen: Set<number> = new Set(),
): ParseSseChunkResult {
  const combined = (buffer + chunk).replace(/\r\n/g, "\n");
  const blocks = combined.split("\n\n");
  const remainder = blocks.pop() ?? "";
  const events: BackboardRunEventEnvelope[] = [];

  for (const block of blocks) {
    if (block.trim().length === 0) continue;

    const dataLines = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart());
    if (dataLines.length === 0) continue;

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(dataLines.join("\n"));
    } catch {
      continue;
    }

    const validated = backboardRunEventEnvelopeSchema.safeParse(parsedJson);
    if (!validated.success) continue;

    if (seen.has(validated.data.sequence)) continue;
    seen.add(validated.data.sequence);
    events.push(validated.data);
  }

  return { events, remainder };
}

export interface CreateRunStreamClientOptions {
  url: string;
  body: unknown;
  signal?: AbortSignal;
  onEvent: (event: BackboardRunEventEnvelope) => void;
  onError?: (error: Error) => void;
  onDone?: () => void;
}

export interface RunStreamHandle {
  abort: () => void;
}

/**
 * POSTs `body` to `url` and streams the SSE response, calling `onEvent` for
 * every validated, non-duplicate envelope in order. Returns immediately with
 * a handle; the actual request runs in the background. Aborting (via the
 * returned handle or the caller's own `signal`) stops the fetch and never
 * fires `onError`, only `onDone`, since a deliberate cancellation is not a
 * failure.
 */
export function createRunStreamClient(options: CreateRunStreamClientOptions): RunStreamHandle {
  const controller = new AbortController();
  if (options.signal) {
    if (options.signal.aborted) {
      controller.abort();
    } else {
      options.signal.addEventListener("abort", () => controller.abort());
    }
  }

  void (async () => {
    let buffer = "";
    const seen = new Set<number>();

    try {
      const response = await fetch(options.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(options.body),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`Run stream request to ${options.url} failed with status ${response.status}.`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      const dispatch = async (events: BackboardRunEventEnvelope[]) => {
        // yield between events so React can paint mid-chunk (else deltas batch into one pop)
        for (const event of events) {
          options.onEvent(event);
          await new Promise<void>((resolve) => {
            if (typeof requestAnimationFrame === "function") {
              requestAnimationFrame(() => resolve());
            } else {
              setTimeout(resolve, 0);
            }
          });
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          // Flush decoder + any complete SSE frames left in the remainder.
          const tail = decoder.decode();
          const { events } = parseSseChunk(buffer, tail, seen);
          buffer = "";
          await dispatch(events);
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        const { events, remainder } = parseSseChunk(buffer, chunk, seen);
        buffer = remainder;
        await dispatch(events);
      }

      options.onDone?.();
    } catch (error) {
      if (controller.signal.aborted) {
        options.onDone?.();
        return;
      }
      options.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  })();

  return { abort: () => controller.abort() };
}
