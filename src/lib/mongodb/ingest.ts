import { randomUUID } from "node:crypto";

import { getMongoDb } from "@/lib/mongodb/client";
import { COLLECTIONS, DEMO_PROVENANCE } from "@/lib/mongodb/collections";
import { isMongoConfigured } from "@/lib/mongodb/env";
import { seedMongoFromFixtures, type SeedSummary } from "@/lib/mongodb/seed";

export interface IngestPipelineResult {
  ingestId: string;
  steps: Array<{ step: string; ok: boolean; detail: string }>;
  seed: SeedSummary | null;
}

/**
 * Offline-first ingest (§8.3): checksum metadata → normalize → load Mongo →
 * demo snapshot. Uses committed TypeScript fixtures (not live GTFS). Live
 * GTFS download can replace the seed step later without changing callers.
 */
export async function runOfflineIngestPipeline(): Promise<IngestPipelineResult> {
  const ingestId = randomUUID();
  const steps: IngestPipelineResult["steps"] = [];
  const now = new Date().toISOString();

  if (!isMongoConfigured()) {
    steps.push({ step: "configure", ok: false, detail: "MONGODB_URI is not set." });
    return { ingestId, steps, seed: null };
  }

  const db = await getMongoDb();

  const sourceName = "TechTO demo fixtures (src/data/transit)";
  const checksum = `fixture-bundle:${DEMO_PROVENANCE.transformationVersion}`;

  await db.collection(COLLECTIONS.rawIngestEvents).insertOne({
    ingestId,
    stage: "download",
    sourceName,
    checksum,
    recordedAt: now,
    provenance: DEMO_PROVENANCE,
  });
  steps.push({ step: "download", ok: true, detail: `Referenced ${sourceName}` });

  await db.collection(COLLECTIONS.rawIngestEvents).insertOne({
    ingestId,
    stage: "checksum",
    checksum,
    recordedAt: now,
    ok: true,
  });
  steps.push({ step: "checksum", ok: true, detail: checksum });

  await db.collection(COLLECTIONS.rawIngestEvents).insertOne({
    ingestId,
    stage: "normalize",
    timezone: "America/Toronto",
    recordedAt: now,
    ok: true,
  });
  steps.push({ step: "normalize", ok: true, detail: "America/Toronto + synthetic schema" });

  let seed: SeedSummary | null = null;
  try {
    seed = await seedMongoFromFixtures();
    await db.collection(COLLECTIONS.rawIngestEvents).insertOne({
      ingestId,
      stage: "load",
      upserted: seed.upserted,
      recordedAt: new Date().toISOString(),
      ok: true,
    });
    steps.push({
      step: "load",
      ok: true,
      detail: `Upserted ${Object.values(seed.upserted).reduce((a, b) => a + b, 0)} documents`,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await db.collection(COLLECTIONS.streamDeadLetters).insertOne({
      deadLetterId: randomUUID(),
      ingestId,
      stage: "load",
      error: detail,
      recordedAt: new Date().toISOString(),
    });
    steps.push({ step: "load", ok: false, detail });
    return { ingestId, steps, seed: null };
  }

  await db.collection(COLLECTIONS.latestCityState).updateOne(
    { cityId: "toronto" },
    {
      $set: {
        cityId: "toronto",
        lastIngestId: ingestId,
        lastIngestAt: new Date().toISOString(),
        snapshotLabel: "demo-snapshot",
        provenance: DEMO_PROVENANCE,
      },
    },
    { upsert: true },
  );
  steps.push({ step: "demo-snapshot", ok: true, detail: "latest_city_state updated" });

  await db.collection(COLLECTIONS.rawIngestEvents).insertOne({
    ingestId,
    stage: "complete",
    recordedAt: new Date().toISOString(),
    ok: true,
  });
  steps.push({ step: "complete", ok: true, detail: ingestId });

  return { ingestId, steps, seed };
}
