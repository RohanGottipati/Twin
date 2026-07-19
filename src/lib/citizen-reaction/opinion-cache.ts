import { createHash } from "node:crypto";

import { getMongoDb } from "@/lib/mongodb/client";
import { COLLECTIONS } from "@/lib/mongodb/collections";
import { generateOpinion } from "@/lib/citizen-reaction/flash-opinion-client";

/**
 * Get-or-generate cache for real per-persona opinion generations, keyed by
 * (personaId, policyHash). Repeated evaluations of the same rendered policy
 * text (e.g. re-running the same scenario) reuse a persona's prior real
 * generation instead of re-calling the live model.
 */

interface OpinionCacheDoc {
  personaId: string;
  policyHash: string;
  opinionText: string;
  model: string;
  generatedAt: string;
}

let indexEnsured = false;

async function ensureIndex(): Promise<void> {
  if (indexEnsured) return;
  const db = await getMongoDb();
  await db
    .collection(COLLECTIONS.opinionReactionsCache)
    .createIndex({ personaId: 1, policyHash: 1 }, { unique: true });
  indexEnsured = true;
}

export function hashPolicyText(policyText: string): string {
  return createHash("sha256").update(policyText).digest("hex");
}

export async function getOrGenerateOpinion(
  personaId: string,
  personaText: string,
  policyText: string,
): Promise<string> {
  await ensureIndex();
  const policyHash = hashPolicyText(policyText);
  const db = await getMongoDb();
  const collection = db.collection<OpinionCacheDoc>(COLLECTIONS.opinionReactionsCache);

  const cached = await collection.findOne({ personaId, policyHash });
  if (cached) return cached.opinionText;

  const opinionText = await generateOpinion(personaText, policyText);
  await collection.updateOne(
    { personaId, policyHash },
    {
      $setOnInsert: {
        personaId,
        policyHash,
        opinionText,
        model: process.env.TECHTO_OPINION_MODEL_ALIAS?.trim() || "flash-1784401342-0d51be72",
        generatedAt: new Date().toISOString(),
      },
    },
    { upsert: true },
  );
  return opinionText;
}
