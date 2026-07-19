import { z } from "zod";

import { getBackboardAdapter } from "@/lib/backboard/adapter";
import type { WebSearchMode } from "@/lib/backboard/client";
import { askOperatorQuestion } from "@/lib/backboard/operator";
import { errorMessage, jsonError } from "@/lib/backboard/route-helpers";
import { createSseResponse, createSseStream } from "@/lib/backboard/sse";
import type { TechTORunEventEnvelope } from "@/lib/transit/schemas";
import { requireScenario } from "@/data/transit/scenarios";
import { persistOperatorThreadTurn } from "@/lib/mongodb/planning-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_QUESTION_LENGTH = 1000;
const MAX_RUN_CONTEXT_LENGTH = 4000;

const operatorQuestionRequestSchema = z
  .object({
    scenarioId: z.string().min(1).max(80),
    threadId: z.string().min(1).max(200).optional(),
    runContext: z.string().max(MAX_RUN_CONTEXT_LENGTH).optional(),
    question: z.string().min(1).max(MAX_QUESTION_LENGTH),
    includeWebSearch: z.boolean().optional(),
  })
  .strict();

function toWebSearchMode(includeWebSearch: boolean | undefined): WebSearchMode | undefined {
  if (includeWebSearch === undefined) return undefined;
  return includeWebSearch ? "Auto" : "off";
}

function generateQuestionId(): string {
  return `question-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
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
 * Streams a single operator follow-up answer as SSE. Only two event types
 * ever cross this boundary: `operator.delta` (a content token) and
 * `operator.completed` (the final structured answer), or `operator.failed`
 * on error; the model's raw reasoning is never forwarded (see
 * askOperatorQuestion's onDelta, which is only ever wired to content
 * deltas).
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = operatorQuestionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("Invalid request body.", 400, { issues: parsed.error.issues });
  }

  const { scenarioId, threadId, runContext, question, includeWebSearch } = parsed.data;
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
      const result = await askOperatorQuestion({
        scenarioId,
        threadId,
        runContext,
        question,
        webSearch: toWebSearchMode(includeWebSearch),
        adapter,
        onDelta: (content) => {
          if (aborted || writer.closed) return;
          sequence += 1;
          writer.send(envelope(questionId, sequence, "operator.delta", { content }));
        },
      });
      if (aborted || writer.closed) return;
      sequence += 1;
      void persistOperatorThreadTurn({
        threadId: result.threadId,
        scenarioId,
        question,
        answer: JSON.stringify(result.answer),
        questionId,
      });
      writer.send(
        envelope(questionId, sequence, "operator.completed", {
          answer: result.answer,
          threadId: result.threadId,
        }),
      );
    } catch (error) {
      if (aborted || writer.closed) return;
      sequence += 1;
      writer.send(envelope(questionId, sequence, "operator.failed", { message: errorMessage(error) }));
    }
  });

  return createSseResponse(stream);
}
