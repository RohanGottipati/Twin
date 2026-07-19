import { z } from "zod";

import { getBackboardAdapter } from "@/lib/backboard/adapter";
import type { WebSearchMode } from "@/lib/backboard/client";
import { askPlaceChat } from "@/lib/backboard/place-chat";
import { errorMessage, jsonError } from "@/lib/backboard/route-helpers";
import { createSseResponse, createSseStream } from "@/lib/backboard/sse";
import type { TechTORunEventEnvelope } from "@/lib/transit/schemas";
import { requireScenario } from "@/data/transit/scenarios";
import { persistPlaceChatThreadTurn } from "@/lib/mongodb/planning-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_QUESTION_LENGTH = 1000;

const selectedPlaceSchema = z
  .object({
    kind: z.enum(["building", "station", "neighbourhood"]),
    id: z.string().min(1).max(200),
    label: z.string().min(1).max(200),
    coordinates: z.tuple([z.number(), z.number()]),
    stationId: z.string().nullable(),
    neighbourhoodId: z.string().nullable(),
    properties: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const placeChatRequestSchema = z
  .object({
    scenarioId: z.string().min(1).max(80),
    threadId: z.string().min(1).max(200).optional(),
    question: z.string().min(1).max(MAX_QUESTION_LENGTH),
    place: selectedPlaceSchema.nullable().optional(),
    includeWebSearch: z.boolean().optional(),
    mapContext: z
      .object({
        center: z.tuple([z.number(), z.number()]).optional(),
        zoom: z.number().optional(),
        selectedStationId: z.string().nullable().optional(),
        selectedNeighbourhoodId: z.string().nullable().optional(),
        highlightedNeighbourhoodIds: z.array(z.string()).optional(),
        visibleLayers: z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

function toWebSearchMode(includeWebSearch: boolean | undefined): WebSearchMode | undefined {
  if (includeWebSearch === undefined) return undefined;
  return includeWebSearch ? "Auto" : "off";
}

function generateQuestionId(): string {
  return `place-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

function envelope(
  questionId: string,
  sequence: number,
  type: string,
  payload: Record<string, unknown>,
): TechTORunEventEnvelope {
  return {
    eventId: `${questionId}:${sequence}`,
    runId: questionId,
    sequence,
    type,
    timestamp: new Date().toISOString(),
    payload,
  };
}

/**
 * Streams a place-scoped (building / station) chat answer via the best
 * Backboard specialist for the classified intent. Events: place.delta,
 * place.completed, place.failed.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = placeChatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("Invalid request body.", 400, { issues: parsed.error.issues });
  }

  const { scenarioId, threadId, question, place, includeWebSearch, mapContext } = parsed.data;
  try {
    requireScenario(scenarioId);
  } catch (error) {
    return jsonError(errorMessage(error), 404);
  }

  const adapter = getBackboardAdapter();

  const questionId = generateQuestionId();
  let sequence = 0;
  let aborted = false;
  request.signal.addEventListener("abort", () => {
    aborted = true;
  });

  const stream = createSseStream(async (writer) => {
    try {
      const result = await askPlaceChat({
        scenarioId,
        threadId,
        question,
        place: place ?? null,
        mapContext,
        webSearch: toWebSearchMode(includeWebSearch),
        adapter,
        onDelta: (content) => {
          if (aborted || writer.closed) return;
          sequence += 1;
          writer.send(envelope(questionId, sequence, "place.delta", { content }));
        },
      });
      if (aborted || writer.closed) return;
      sequence += 1;
      void persistPlaceChatThreadTurn({
        threadId: result.threadId,
        scenarioId,
        question,
        answer: result.answer.answer,
        questionId,
        assistantKey: result.assistantKey,
        placeId: place?.id,
      });
      writer.send(
        envelope(questionId, sequence, "place.completed", {
          answer: result.answer,
          threadId: result.threadId,
          assistantKey: result.assistantKey,
          intent: result.intent,
          mapActions: result.mapActions,
        }),
      );
    } catch (error) {
      if (aborted || writer.closed) return;
      sequence += 1;
      writer.send(envelope(questionId, sequence, "place.failed", { message: errorMessage(error) }));
    }
  });

  return createSseResponse(stream);
}
