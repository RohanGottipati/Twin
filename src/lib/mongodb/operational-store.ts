import { randomUUID } from "node:crypto";

import type { CitizenReactionBatchResult } from "@/lib/citizen-reaction/schemas";
import { getMongoDb } from "@/lib/mongodb/client";
import { COLLECTIONS, DEMO_PROVENANCE } from "@/lib/mongodb/collections";
import { isMongoConfigured } from "@/lib/mongodb/env";
import type { TransitIntervention, TransitSimulationResult } from "@/lib/transit/schemas";

/**
 * Best-effort writes for planning artifacts. When Mongo is not configured or
 * a write fails, returns persisted:false so tool dispatch still succeeds
 * (fixture/CI and demos must not die on Atlas blips).
 */
export async function persistSimulationRun(input: {
  scenarioId: string;
  intervention: TransitIntervention;
  result: TransitSimulationResult;
  runId?: string;
}): Promise<{ persisted: boolean; runId: string | null; error?: string }> {
  if (!isMongoConfigured()) return { persisted: false, runId: null };

  const runId = input.runId ?? randomUUID();
  const now = new Date().toISOString();

  try {
    const db = await getMongoDb();

    await db.collection(COLLECTIONS.simulationRuns).updateOne(
      { runId },
      {
        $set: {
          runId,
          scenarioId: input.scenarioId,
          interventionId: input.intervention.id,
          intervention: input.intervention,
          metrics: input.result.metrics,
          valid: input.result.valid,
          violations: input.result.violations,
          departureLoads: input.result.departureLoads,
          dataMode: "synthetic-fixture",
          provenance: DEMO_PROVENANCE,
          recordedAt: now,
        },
      },
      { upsert: true },
    );

    await db.collection(COLLECTIONS.interventions).updateOne(
      { interventionId: input.intervention.id },
      {
        $set: {
          interventionId: input.intervention.id,
          scenarioId: input.scenarioId,
          intervention: input.intervention,
          lastSimulationRunId: runId,
          lastValid: input.result.valid,
          dataMode: "synthetic-fixture",
          provenance: DEMO_PROVENANCE,
          updatedAt: now,
        },
      },
      { upsert: true },
    );

    if (input.result.departureLoads[0]) {
      const stopId = `${input.scenarioId}-platform`;
      await db.collection(COLLECTIONS.latestStopState).updateOne(
        { stopId },
        {
          $set: {
            stopId,
            scenarioId: input.scenarioId,
            interventionId: input.intervention.id,
            peakLoadFactor: Math.max(...input.result.departureLoads.map((d) => d.loadFactor)),
            deniedBoardings: input.result.metrics.deniedBoardings,
            meanWaitMinutes: input.result.metrics.meanWaitMinutes,
            updatedAt: now,
            dataMode: "synthetic-fixture",
            provenance: DEMO_PROVENANCE,
          },
        },
        { upsert: true },
      );
    }

    return { persisted: true, runId };
  } catch (error) {
    return {
      persisted: false,
      runId,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function persistPolicyIteration(input: {
  scenarioId: string;
  intervention: TransitIntervention;
  iterationLabel: string;
  notes?: string;
}): Promise<{ persisted: boolean; iterationId: string | null; error?: string }> {
  if (!isMongoConfigured()) return { persisted: false, iterationId: null };

  const iterationId = randomUUID();
  const now = new Date().toISOString();

  try {
    const db = await getMongoDb();

    await db.collection(COLLECTIONS.policyIterations).updateOne(
      { iterationId },
      {
        $set: {
          iterationId,
          scenarioId: input.scenarioId,
          interventionId: input.intervention.id,
          intervention: input.intervention,
          iterationLabel: input.iterationLabel,
          notes: input.notes ?? null,
          dataMode: "synthetic-fixture",
          provenance: DEMO_PROVENANCE,
          recordedAt: now,
        },
      },
      { upsert: true },
    );

    await db.collection(COLLECTIONS.auditEvents).insertOne({
      auditId: randomUUID(),
      type: "policy_iteration_saved",
      scenarioId: input.scenarioId,
      interventionId: input.intervention.id,
      iterationId,
      recordedAt: now,
      provenance: DEMO_PROVENANCE,
    });

    return { persisted: true, iterationId };
  } catch (error) {
    return {
      persisted: false,
      iterationId,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function persistCitizenReactions(input: {
  scenarioId: string;
  interventionId: string;
  batch: CitizenReactionBatchResult;
}): Promise<{ persisted: boolean; batchId: string | null; error?: string }> {
  if (!isMongoConfigured()) return { persisted: false, batchId: null };

  const batchId = randomUUID();
  const now = new Date().toISOString();

  try {
    const db = await getMongoDb();

    await db.collection(COLLECTIONS.citizenReactions).insertOne({
      batchId,
      scenarioId: input.scenarioId,
      interventionId: input.interventionId,
      reactions: input.batch.reactions,
      aggregate: input.batch.aggregate,
      provider: input.batch.provider,
      label: "simulated-citizen-reactions",
      dataMode: "synthetic-fixture",
      provenance: DEMO_PROVENANCE,
      recordedAt: now,
    });

    return { persisted: true, batchId };
  } catch (error) {
    return {
      persisted: false,
      batchId,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function persistTrainingExamples(input: {
  scenarioId: string;
  interventionId: string;
  label: string;
  rows: unknown[];
}): Promise<{ persisted: boolean; exampleId: string | null; error?: string }> {
  if (!isMongoConfigured()) return { persisted: false, exampleId: null };

  const exampleId = randomUUID();
  const now = new Date().toISOString();

  try {
    const db = await getMongoDb();

    await db.collection(COLLECTIONS.trainingExamples).insertOne({
      exampleId,
      scenarioId: input.scenarioId,
      interventionId: input.interventionId,
      label: input.label,
      rows: input.rows,
      status: "curated-candidate",
      dataMode: "synthetic-fixture",
      provenance: DEMO_PROVENANCE,
      recordedAt: now,
    });

    return { persisted: true, exampleId };
  } catch (error) {
    return {
      persisted: false,
      exampleId,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function persistBackboardToolCall(input: {
  runId?: string;
  assistantId: string;
  toolName: string;
  ok: boolean;
  argsSummary?: string;
}): Promise<void> {
  if (!isMongoConfigured()) return;
  try {
    const db = await getMongoDb();
    await db.collection(COLLECTIONS.backboardToolCalls).insertOne({
      toolCallId: randomUUID(),
      runId: input.runId ?? null,
      assistantId: input.assistantId,
      toolName: input.toolName,
      ok: input.ok,
      argsSummary: input.argsSummary ?? null,
      recordedAt: new Date().toISOString(),
    });
  } catch {
    // best-effort only
  }
}
