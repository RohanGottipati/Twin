import { PRINCIPLED_CITY_BUNDLE } from "@/lib/backboard/assistants";
import { errorMessage, jsonError } from "@/lib/backboard/route-helpers";
import { createSseResponse, createSseStream } from "@/lib/backboard/sse";
import { runCityOrchestration, type CityRunEvent } from "@/lib/planner/orchestrator";
import { plannerRunBodySchema } from "@/lib/planner/request";
import { getCitizenReactionProviderMode } from "@/lib/citizen-reaction/provider";
import type { TechTORunEventEnvelope } from "@/lib/transit/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function envelope(
  runId: string,
  sequence: number,
  type: string,
  payload: Record<string, unknown>,
): TechTORunEventEnvelope {
  return {
    eventId: `${runId}:${sequence}`,
    runId,
    sequence,
    type,
    timestamp: new Date().toISOString(),
    payload,
  };
}

/**
 * Streams City Code agent lifecycle + content tokens as SSE.
 * Events: planner.delta, planner.clear, planner.status, planner.completed, planner.failed
 * (plus passthrough lifecycle types from CityRunEvent).
 */
export async function POST(request: Request) {
  const bodyRaw = await request.json().catch(() => null);
  const parsed = plannerRunBodySchema.safeParse(bodyRaw);
  if (!parsed.success) {
    return jsonError("Invalid request body.", 400, { issues: parsed.error.issues });
  }

  const body = parsed.data;
  let sequence = 0;
  let aborted = false;
  request.signal.addEventListener("abort", () => {
    aborted = true;
  });

  const stream = createSseStream(async (writer) => {
    const send = (type: string, payload: Record<string, unknown>, runId = "planner") => {
      if (aborted || writer.closed) return;
      sequence += 1;
      writer.send(envelope(runId, sequence, type, payload));
    };

    // open the pipe immediately so the UI isnt stuck on a blank spinner
    // (no chat line: agent.started / tool lines carry the log)

    try {
      const result = await runCityOrchestration({
        question: body.question,
        patches: body.patches,
        seed: body.seed ?? 2262,
        agentOverlays: body.agentOverlays,
        threadId: body.threadId,
        history: body.history,
        onEvent: (event: CityRunEvent) => {
          if (aborted || writer.closed) return;
          if (event.type === "assistant.delta") {
            send("planner.delta", { content: event.content }, event.runId);
            return;
          }
          if (event.type === "assistant.reasoning") {
            send("planner.reasoning", { content: event.content }, event.runId);
            return;
          }
          if (event.type === "assistant.clear") {
            send("planner.clear", {}, event.runId);
            return;
          }
          if (event.type === "status") {
            send("planner.status", { message: event.message }, event.runId);
            return;
          }
          if (event.type === "map.actions") {
            // Apply as soon as the agent composes them (don't wait for turn end).
            send("planner.map_actions", { actions: event.actions }, event.runId);
            return;
          }
          if (event.type === "persona.scored") {
            // Colour the sampled resident's dot on the map as soon as this one real model call resolves.
            send(
              "planner.persona_scored",
              {
                personaId: event.personaId,
                code: event.code,
                acceptance: event.acceptance,
                opinionText: event.opinionText,
              },
              event.runId,
            );
            return;
          }
          // coarse lifecycle for the strip / debug
          send(event.type, { ...event }, event.runId);
        },
      });

      if (aborted || writer.closed) return;
      send(
        "planner.completed",
        {
          schemaVersion: 1,
          backboardMode: result.adapterMode,
          populationMode: getCitizenReactionProviderMode(),
          availableRoster: PRINCIPLED_CITY_BUNDLE,
          participatingAgents: result.participatingAgents,
          runId: result.runId,
          threadId: result.threadId,
          question: result.question,
          ranking: result.ranking,
          chosenId: result.chosenId,
          summary: result.summary,
          mapActions: result.mapActions,
          events: result.events.map((e) => e.type),
          candidates: result.candidates.map((c) => ({
            patch: c.patch,
            score: {
              scenarioId: c.score.scenarioId,
              provider: c.score.provider,
              citywide: c.score.citywide,
              byNeighbourhood: c.score.byNeighbourhood,
            },
          })),
        },
        result.runId,
      );
    } catch (error) {
      send("planner.failed", { message: errorMessage(error) });
    }
  });

  return createSseResponse(stream);
}
