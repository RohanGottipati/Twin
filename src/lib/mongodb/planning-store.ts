import { randomUUID } from "node:crypto";

import type { TwinTORunEvent, TwinTORunResult } from "@/lib/backboard/orchestrator";
import { getMongoDb } from "@/lib/mongodb/client";
import { COLLECTIONS, DEMO_PROVENANCE } from "@/lib/mongodb/collections";
import { isMongoConfigured } from "@/lib/mongodb/env";

function summarizeEvent(event: TwinTORunEvent): Record<string, unknown> {
  switch (event.type) {
    case "run.started":
      return { scenarioId: event.scenarioId };
    case "problem.completed":
    case "baseline.completed":
    case "context.completed":
    case "impact.completed":
    case "debate.completed":
      return { summary: event.summary };
    case "policy.generated":
      return { interventionId: event.intervention.id, label: event.intervention.label };
    case "citizens.completed":
      return { candidateId: event.candidateId, provider: event.result.provider };
    case "simulation.completed":
    case "stress.completed":
      return { candidateId: event.candidateId, summary: event.summary };
    case "recommendation.ready":
      return {
        chosenCandidateId: event.recommendation.chosenCandidateId,
        recommendedAction: event.recommendation.recommendedAction,
        overridden: event.overridden,
      };
    case "operator.ready":
      return { question: event.question };
    case "run.completed":
      return {
        chosenCandidateId: event.result.effectiveRecommendation.chosenCandidateId,
        recommendedAction: event.result.effectiveRecommendation.recommendedAction,
      };
    case "run.failed":
      return { error: event.error };
    case "agent.started":
    case "agent.completed":
    case "agent.failed":
      return { role: event.role, name: event.name };
    case "tool.requested":
    case "tool.completed":
      return { role: event.role, toolName: event.toolName, ok: "ok" in event ? event.ok : undefined };
    default:
      return {};
  }
}

/** Append one planning SSE event and keep the run shell document in sync. */
export async function persistPlanningRunEvent(input: {
  event: TwinTORunEvent;
  sequence: number;
}): Promise<void> {
  if (!isMongoConfigured()) return;

  const { event, sequence } = input;
  const now = new Date().toISOString();

  try {
    const db = await getMongoDb();
    const runId = event.runId;

    await db.collection(COLLECTIONS.backboardEvents).insertOne({
      eventId: `${runId}:${sequence}`,
      runId,
      sequence,
      type: event.type,
      summary: summarizeEvent(event),
      recordedAt: now,
      provenance: DEMO_PROVENANCE,
    });

    if (event.type === "run.started") {
      await db.collection(COLLECTIONS.backboardThreads).updateOne(
        { threadId: runId },
        {
          $set: {
            threadId: runId,
            kind: "planning-run",
            scenarioId: event.scenarioId,
            status: "running",
            startedAt: now,
            updatedAt: now,
            provenance: DEMO_PROVENANCE,
          },
          $setOnInsert: { createdAt: now },
        },
        { upsert: true },
      );
      return;
    }

    if (event.type === "recommendation.ready") {
      await db.collection(COLLECTIONS.policyEvaluations).updateOne(
        { evaluationId: runId },
        {
          $set: {
            evaluationId: runId,
            runId,
            recommendation: event.recommendation,
            overridden: event.overridden,
            overrideReason: event.overrideReason ?? null,
            status: "recommended",
            updatedAt: now,
            provenance: DEMO_PROVENANCE,
          },
        },
        { upsert: true },
      );
      await db.collection(COLLECTIONS.backboardThreads).updateOne(
        { threadId: runId },
        {
          $set: {
            status: "recommended",
            recommendation: event.recommendation,
            updatedAt: now,
          },
        },
      );
      return;
    }

    if (event.type === "run.completed") {
      await finalizePlanningRun({ runId, status: "completed", result: event.result });
      return;
    }

    if (event.type === "run.failed") {
      await db.collection(COLLECTIONS.backboardThreads).updateOne(
        { threadId: runId },
        { $set: { status: "failed", error: event.error, updatedAt: now } },
      );
    }
  } catch {
    // best-effort; never break the SSE stream
  }
}

export async function finalizePlanningRun(input: {
  runId: string;
  status: "completed" | "failed";
  result?: TwinTORunResult;
  error?: string;
}): Promise<void> {
  if (!isMongoConfigured()) return;
  const now = new Date().toISOString();
  try {
    const db = await getMongoDb();
    await db.collection(COLLECTIONS.backboardThreads).updateOne(
      { threadId: input.runId },
      {
        $set: {
          threadId: input.runId,
          kind: "planning-run",
          status: input.status,
          result: input.result ?? null,
          error: input.error ?? null,
          completedAt: now,
          updatedAt: now,
          provenance: DEMO_PROVENANCE,
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true },
    );

    if (input.result) {
      await db.collection(COLLECTIONS.policyEvaluations).updateOne(
        { evaluationId: input.runId },
        {
          $set: {
            evaluationId: input.runId,
            runId: input.runId,
            scenarioId: input.result.scenarioId,
            recommendation: input.result.effectiveRecommendation,
            aiRecommendation: input.result.aiRecommendation,
            ranking: input.result.ranking,
            status: input.status,
            updatedAt: now,
            provenance: DEMO_PROVENANCE,
          },
        },
        { upsert: true },
      );
    }
  } catch {
    // best-effort
  }
}

/** Persist one City Copilot / operator Q&A turn into backboard_threads. */
export async function persistOperatorThreadTurn(input: {
  threadId: string;
  scenarioId: string;
  question: string;
  answer: string;
  questionId: string;
}): Promise<{ persisted: boolean; threadId: string }> {
  if (!isMongoConfigured()) return { persisted: false, threadId: input.threadId };

  const now = new Date().toISOString();
  const threadId = input.threadId || `thread-${randomUUID()}`;

  try {
    const db = await getMongoDb();
    const newMessages = [
      {
        messageId: `${input.questionId}:user`,
        role: "user",
        content: input.question,
        recordedAt: now,
      },
      {
        messageId: `${input.questionId}:assistant`,
        role: "assistant",
        content: input.answer,
        recordedAt: now,
      },
    ];

    const existing = await db.collection(COLLECTIONS.backboardThreads).findOne({ threadId });
    const priorMessages = Array.isArray(existing?.messages) ? existing.messages : [];

    await db.collection(COLLECTIONS.backboardThreads).updateOne(
      { threadId },
      {
        $set: {
          threadId,
          kind: "operator-qa",
          scenarioId: input.scenarioId,
          status: "active",
          messages: [...priorMessages, ...newMessages],
          updatedAt: now,
          provenance: DEMO_PROVENANCE,
          createdAt: existing?.createdAt ?? now,
        },
      },
      { upsert: true },
    );
    return { persisted: true, threadId };
  } catch {
    return { persisted: false, threadId };
  }
}

export async function getPlanningRun(runId: string): Promise<Record<string, unknown> | null> {
  if (!isMongoConfigured()) return null;
  const db = await getMongoDb();
  const doc = await db.collection(COLLECTIONS.backboardThreads).findOne({ threadId: runId });
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return rest as Record<string, unknown>;
}

export async function listPlanningRunEvents(runId: string, limit = 200): Promise<Record<string, unknown>[]> {
  if (!isMongoConfigured()) return [];
  const db = await getMongoDb();
  const docs = await db
    .collection(COLLECTIONS.backboardEvents)
    .find({ runId })
    .sort({ sequence: 1 })
    .limit(limit)
    .toArray();
  return docs.map(({ _id, ...rest }) => rest as Record<string, unknown>);
}
