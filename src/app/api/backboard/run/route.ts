import { z } from "zod";

import { getBackboardAdapter } from "@/lib/backboard/adapter";
import { runTechTOOrchestration, type TechTORunEvent } from "@/lib/backboard/orchestrator";
import { errorMessage, jsonError } from "@/lib/backboard/route-helpers";
import { clientKeyFor, isRunRateLimited } from "@/lib/backboard/run-rate-limit";
import { createSseResponse, createSseStream, toTechTORunEventEnvelope } from "@/lib/backboard/sse";
import { requireScenario } from "@/data/transit/scenarios";
import { persistPlanningRunEvent } from "@/lib/mongodb/planning-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 20_000;
const MAX_ID_LENGTH = 80;

const runRequestSchema = z
  .object({
    scenarioId: z.string().min(1).max(MAX_ID_LENGTH),
    includeWebSearch: z.boolean().optional(),
  })
  .strict();

/**
 * Starts one TechTO planning run and streams its lifecycle as SSE. The
 * response body is a live ReadableStream, so every check that can fail
 * cheaply (rate limit, body size, schema, unknown scenario) happens before
 * the stream is created; once streaming starts, an orchestration failure is
 * reported as a run.failed event by the orchestrator itself rather than as
 * an HTTP error status, since headers are already committed.
 */
export async function POST(request: Request) {
  if (isRunRateLimited(clientKeyFor(request))) {
    return jsonError("Too many run requests. Please wait before starting another run.", 429);
  }

  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return jsonError("Request body too large.", 413);
  }

  let json: unknown;
  try {
    json = rawBody.length > 0 ? JSON.parse(rawBody) : {};
  } catch {
    return jsonError("Request body was not valid JSON.", 400);
  }

  const parsed = runRequestSchema.safeParse(json);
  if (!parsed.success) {
    return jsonError("Invalid request body.", 400, { issues: parsed.error.issues });
  }

  const { scenarioId, includeWebSearch } = parsed.data;
  try {
    requireScenario(scenarioId);
  } catch (error) {
    return jsonError(errorMessage(error), 404);
  }

  let aborted = false;
  request.signal.addEventListener("abort", () => {
    aborted = true;
  });

  const adapter = getBackboardAdapter();

  let sequence = 0;
  const stream = createSseStream(async (writer) => {
    await runTechTOOrchestration({
      scenarioId,
      includeWebSearch,
      adapter,
      onEvent: (event: TechTORunEvent) => {
        if (aborted || writer.closed) return;
        sequence += 1;
        writer.send(toTechTORunEventEnvelope(event, sequence));
        void persistPlanningRunEvent({ event, sequence });
      },
    }).catch(() => {
      // runTechTOOrchestration already emitted a run.failed event with the
      // error message via onEvent above (see orchestrator.ts); swallow the
      // rethrow here so it does not surface as an unhandled stream.error.
    });
  });

  return createSseResponse(stream);
}
