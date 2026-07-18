import type { Db, IndexDescription } from "mongodb";

import { COLLECTIONS, TIME_SERIES_COLLECTIONS } from "@/lib/mongodb/collections";
import { getMongoDb } from "@/lib/mongodb/client";

async function ensureCollection(db: Db, name: string): Promise<void> {
  const existing = await db.listCollections({ name }).toArray();
  if (existing.length === 0) {
    await db.createCollection(name);
  }
}

async function ensureTimeSeries(db: Db, name: string): Promise<void> {
  const existing = await db.listCollections({ name }).toArray();
  if (existing.length > 0) return;
  try {
    await db.createCollection(name, {
      timeseries: {
        timeField: "timestamp",
        metaField: "meta",
        granularity: "minutes",
      },
    });
  } catch (error) {
    // Older tiers or restricted roles may reject time-series creation; fall back.
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("already exists")) return;
    await ensureCollection(db, name);
  }
}

async function ensureIndexes(db: Db, name: string, indexes: IndexDescription[]): Promise<void> {
  if (indexes.length === 0) return;
  await db.collection(name).createIndexes(indexes);
}

/**
 * Creates TwinTO collections and core indexes. Idempotent.
 * Atlas Search / Vector Search indexes are configured in Atlas UI using
 * MONGODB_SEARCH_INDEX / MONGODB_VECTOR_INDEX env names; they are not
 * created here (require Atlas admin APIs).
 */
export async function bootstrapMongoCollections(databaseName?: string): Promise<{
  database: string;
  collections: string[];
  timeSeries: string[];
}> {
  const db = await getMongoDb(databaseName);

  for (const name of Object.values(COLLECTIONS)) {
    await ensureCollection(db, name);
  }
  for (const name of Object.values(TIME_SERIES_COLLECTIONS)) {
    await ensureTimeSeries(db, name);
  }

  await ensureIndexes(db, COLLECTIONS.transitStops, [
    { key: { stopId: 1 }, unique: true, name: "uniq_stopId" },
    { key: { location: "2dsphere" }, name: "geo_stop_location" },
    { key: { routeId: 1, sequence: 1 }, name: "route_sequence" },
  ]);
  await ensureIndexes(db, COLLECTIONS.transitRoutes, [
    { key: { routeId: 1 }, unique: true, name: "uniq_routeId" },
  ]);
  await ensureIndexes(db, COLLECTIONS.places, [
    { key: { placeId: 1 }, unique: true, name: "uniq_placeId" },
    { key: { location: "2dsphere" }, name: "geo_place_location" },
  ]);
  await ensureIndexes(db, COLLECTIONS.neighbourhoods, [
    { key: { neighbourhoodId: 1 }, unique: true, name: "uniq_neighbourhoodId" },
    { key: { location: "2dsphere" }, name: "geo_neighbourhood_location" },
  ]);
  await ensureIndexes(db, COLLECTIONS.citizenCohorts, [
    { key: { cohortId: 1 }, unique: true, name: "uniq_cohortId" },
    { key: { homeZoneId: 1 }, name: "cohort_home_zone" },
  ]);
  await ensureIndexes(db, COLLECTIONS.transitScenarios, [
    { key: { scenarioId: 1 }, unique: true, name: "uniq_scenarioId" },
  ]);
  await ensureIndexes(db, COLLECTIONS.stressOverlays, [
    { key: { overlayId: 1 }, unique: true, name: "uniq_overlayId" },
  ]);
  await ensureIndexes(db, COLLECTIONS.events, [
    { key: { eventId: 1 }, unique: true, name: "uniq_eventId" },
    { key: { location: "2dsphere" }, name: "geo_event_location" },
  ]);
  await ensureIndexes(db, COLLECTIONS.incidents, [
    { key: { incidentId: 1 }, unique: true, name: "uniq_incidentId" },
  ]);
  await ensureIndexes(db, COLLECTIONS.simulationRuns, [
    { key: { runId: 1 }, unique: true, name: "uniq_runId" },
    { key: { scenarioId: 1, recordedAt: -1 }, name: "scenario_time" },
  ]);
  await ensureIndexes(db, COLLECTIONS.policyIterations, [
    { key: { iterationId: 1 }, unique: true, name: "uniq_iterationId" },
    { key: { scenarioId: 1, recordedAt: -1 }, name: "iteration_scenario_time" },
  ]);
  await ensureIndexes(db, COLLECTIONS.citizenReactions, [
    { key: { batchId: 1 }, name: "reaction_batch" },
    { key: { interventionId: 1, recordedAt: -1 }, name: "reaction_intervention_time" },
  ]);
  await ensureIndexes(db, COLLECTIONS.latestRouteState, [
    { key: { routeId: 1 }, unique: true, name: "uniq_latest_route" },
  ]);
  await ensureIndexes(db, COLLECTIONS.latestStopState, [
    { key: { stopId: 1 }, unique: true, name: "uniq_latest_stop" },
  ]);
  await ensureIndexes(db, COLLECTIONS.latestCityState, [
    { key: { cityId: 1 }, unique: true, name: "uniq_latest_city" },
  ]);
  await ensureIndexes(db, COLLECTIONS.backboardEvents, [
    { key: { runId: 1, sequence: 1 }, name: "backboard_run_sequence" },
  ]);
  await ensureIndexes(db, COLLECTIONS.similarInterventions, [
    { key: { interventionId: 1 }, unique: true, name: "uniq_similar_id" },
    { key: { tags: 1 }, name: "similar_tags" },
  ]);
  await ensureIndexes(db, COLLECTIONS.simulationBranches, [
    { key: { branchId: 1 }, unique: true, name: "uniq_branchId" },
    { key: { expiresAt: 1 }, expireAfterSeconds: 0, name: "branch_ttl" },
  ]);

  const collections = (await db.listCollections().toArray()).map((c) => c.name).sort();
  return {
    database: db.databaseName,
    collections,
    timeSeries: Object.values(TIME_SERIES_COLLECTIONS),
  };
}
