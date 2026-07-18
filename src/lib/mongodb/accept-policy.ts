import { randomUUID } from "node:crypto";

import { getMongoClient, getMongoDb } from "@/lib/mongodb/client";
import { COLLECTIONS, DEMO_PROVENANCE } from "@/lib/mongodb/collections";
import { isMongoConfigured, requireMongoUri } from "@/lib/mongodb/env";

export interface AcceptPolicyInput {
  runId: string;
  scenarioId: string;
  interventionId: string;
  recommendedAction: "approve" | "approve_with_monitoring" | "hold_for_operator" | "reject_unsafe";
  metrics?: Record<string, unknown>;
  recommendation?: Record<string, unknown>;
  modelVersion?: string;
  notes?: string;
  createTrainingExample?: boolean;
}

export interface AcceptPolicyResult {
  accepted: boolean;
  acceptanceId: string | null;
  usedTransaction: boolean;
  error?: string;
}

/**
 * Atomically records policy acceptance (§14.9): final status, metrics,
 * model version, recommendation, audit event, optional training example.
 * Falls back to sequential writes if the Atlas tier rejects transactions.
 */
export async function acceptPolicyIteration(input: AcceptPolicyInput): Promise<AcceptPolicyResult> {
  if (!isMongoConfigured()) {
    return { accepted: false, acceptanceId: null, usedTransaction: false, error: "MongoDB is not configured." };
  }

  requireMongoUri();
  const acceptanceId = randomUUID();
  const now = new Date().toISOString();

  const writeAll = async (db: Awaited<ReturnType<typeof getMongoDb>>, session?: import("mongodb").ClientSession) => {
    const opts = session ? { session } : {};

    await db.collection(COLLECTIONS.policyIterations).updateOne(
      { iterationId: acceptanceId },
      {
        $set: {
          iterationId: acceptanceId,
          runId: input.runId,
          scenarioId: input.scenarioId,
          interventionId: input.interventionId,
          status: "accepted",
          recommendedAction: input.recommendedAction,
          metrics: input.metrics ?? null,
          recommendation: input.recommendation ?? null,
          modelVersion: input.modelVersion ?? "twinto-demo-1",
          notes: input.notes ?? null,
          recordedAt: now,
          provenance: DEMO_PROVENANCE,
        },
      },
      { upsert: true, ...opts },
    );

    await db.collection(COLLECTIONS.policyEvaluations).updateOne(
      { evaluationId: input.runId },
      {
        $set: {
          evaluationId: input.runId,
          runId: input.runId,
          scenarioId: input.scenarioId,
          status: "accepted",
          acceptanceId,
          recommendedAction: input.recommendedAction,
          metrics: input.metrics ?? null,
          updatedAt: now,
          provenance: DEMO_PROVENANCE,
        },
      },
      { upsert: true, ...opts },
    );

    await db.collection(COLLECTIONS.modelVersions).updateOne(
      { modelVersionId: input.modelVersion ?? "twinto-demo-1" },
      {
        $set: {
          modelVersionId: input.modelVersion ?? "twinto-demo-1",
          alias: "twinto-citizen-reaction",
          lastAcceptedRunId: input.runId,
          updatedAt: now,
          provenance: DEMO_PROVENANCE,
        },
      },
      { upsert: true, ...opts },
    );

    await db.collection(COLLECTIONS.auditEvents).insertOne(
      {
        auditId: randomUUID(),
        type: "policy_accepted",
        acceptanceId,
        runId: input.runId,
        scenarioId: input.scenarioId,
        interventionId: input.interventionId,
        recommendedAction: input.recommendedAction,
        recordedAt: now,
        provenance: DEMO_PROVENANCE,
      },
      opts,
    );

    await db.collection(COLLECTIONS.backboardThreads).updateOne(
      { threadId: input.runId },
      {
        $set: {
          status: "accepted",
          acceptanceId,
          acceptedAt: now,
          updatedAt: now,
        },
      },
      opts,
    );

    if (input.createTrainingExample !== false) {
      await db.collection(COLLECTIONS.trainingExamples).insertOne(
        {
          exampleId: randomUUID(),
          acceptanceId,
          runId: input.runId,
          scenarioId: input.scenarioId,
          interventionId: input.interventionId,
          label: "accepted-policy",
          status: "eligible",
          rows: [
            {
              input: { scenarioId: input.scenarioId, interventionId: input.interventionId },
              output: { recommendedAction: input.recommendedAction, metrics: input.metrics ?? null },
            },
          ],
          recordedAt: now,
          provenance: DEMO_PROVENANCE,
        },
        opts,
      );
    }
  };

  try {
    const client = await getMongoClient();
    const db = await getMongoDb();
    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        await writeAll(db, session);
      });
      return { accepted: true, acceptanceId, usedTransaction: true };
    } catch {
      // Standalone / free-tier clusters may not support multi-doc transactions.
      await writeAll(db);
      return { accepted: true, acceptanceId, usedTransaction: false };
    } finally {
      await session.endSession();
    }
  } catch (error) {
    return {
      accepted: false,
      acceptanceId,
      usedTransaction: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
