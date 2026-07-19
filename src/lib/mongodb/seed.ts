import {
  getConcertEvent,
  getServiceIncidents,
  getWeatherEvent,
} from "@/data/transit/events";
import { listNeighbourhoods } from "@/data/transit/neighbourhoods";
import { getNetworkSnapshot } from "@/data/transit/network";
import { listScenarios, listStressOverlays } from "@/data/transit/scenarios";
import { SIMILAR_INTERVENTIONS } from "@/data/transit/similar-policies";
import { getMongoDb } from "@/lib/mongodb/client";
import { COLLECTIONS, DEMO_PROVENANCE } from "@/lib/mongodb/collections";

export interface SeedSummary {
  database: string;
  upserted: Record<string, number>;
}

/**
 * Upserts TechTO demo fixtures into Atlas. All records carry synthetic
 * provenance; this is not a live GTFS or census load.
 */
export async function seedMongoFromFixtures(databaseName?: string): Promise<SeedSummary> {
  const db = await getMongoDb(databaseName);
  const upserted: Record<string, number> = {};
  const now = new Date().toISOString();

  const network = getNetworkSnapshot();

  await db.collection(COLLECTIONS.cities).updateOne(
    { cityId: "toronto" },
    {
      $set: {
        cityId: "toronto",
        name: "Toronto",
        timezone: "America/Toronto",
        center: { type: "Point", coordinates: [-79.3832, 43.6532] },
        dataMode: "synthetic-fixture",
        provenance: DEMO_PROVENANCE,
        updatedAt: now,
      },
    },
    { upsert: true },
  );
  upserted[COLLECTIONS.cities] = 1;

  let n = 0;
  for (const place of network.stations) {
    await db.collection(COLLECTIONS.places).updateOne(
      { placeId: place.id },
      {
        $set: {
          placeId: place.id,
          kind: "station",
          name: place.name,
          hasElevator: place.hasElevator,
          alternateAccessibleEntrance: place.alternateAccessibleEntrance,
          location: { type: "Point", coordinates: [place.lng, place.lat] },
          dataMode: "synthetic-fixture",
          provenance: DEMO_PROVENANCE,
          updatedAt: now,
        },
      },
      { upsert: true },
    );
    n += 1;
  }
  upserted[COLLECTIONS.places] = n;

  n = 0;
  for (const route of network.routes) {
    await db.collection(COLLECTIONS.transitRoutes).updateOne(
      { routeId: route.id },
      {
        $set: {
          routeId: route.id,
          name: route.name,
          mode: route.mode,
          color: route.color,
          stopIds: route.stopIds,
          vehicleCapacity: route.vehicleCapacity,
          headwayMinutes: route.headwayMinutes,
          dataMode: "synthetic-fixture",
          provenance: DEMO_PROVENANCE,
          updatedAt: now,
        },
      },
      { upsert: true },
    );
    n += 1;
  }
  upserted[COLLECTIONS.transitRoutes] = n;

  n = 0;
  for (const stop of network.stops) {
    await db.collection(COLLECTIONS.transitStops).updateOne(
      { stopId: stop.id },
      {
        $set: {
          stopId: stop.id,
          routeId: stop.routeId,
          name: stop.name,
          sequence: stop.sequence,
          stationId: stop.stationId ?? null,
          location: { type: "Point", coordinates: [stop.lng, stop.lat] },
          dataMode: "synthetic-fixture",
          provenance: DEMO_PROVENANCE,
          updatedAt: now,
        },
      },
      { upsert: true },
    );
    n += 1;
  }
  upserted[COLLECTIONS.transitStops] = n;

  await db.collection(COLLECTIONS.latestCityState).updateOne(
    { cityId: "toronto" },
    {
      $set: {
        cityId: "toronto",
        networkGeneratedAt: network.generatedAt,
        stationCount: network.stations.length,
        routeCount: network.routes.length,
        stopCount: network.stops.length,
        dataMode: "synthetic-fixture",
        provenance: DEMO_PROVENANCE,
        updatedAt: now,
      },
    },
    { upsert: true },
  );
  upserted[COLLECTIONS.latestCityState] = 1;

  n = 0;
  for (const neighbourhood of listNeighbourhoods()) {
    await db.collection(COLLECTIONS.neighbourhoods).updateOne(
      { neighbourhoodId: neighbourhood.id },
      {
        $set: {
          neighbourhoodId: neighbourhood.id,
          name: neighbourhood.name,
          center: neighbourhood.center,
          bounds: neighbourhood.bounds,
          tags: neighbourhood.tags,
          growthProxy: neighbourhood.growthProxy,
          landUse: neighbourhood.landUse,
          underservedAfter22: neighbourhood.underservedAfter22,
          location: { type: "Point", coordinates: neighbourhood.center },
          dataMode: "synthetic-fixture",
          provenance: DEMO_PROVENANCE,
          updatedAt: now,
        },
      },
      { upsert: true },
    );
    n += 1;
  }
  upserted[COLLECTIONS.neighbourhoods] = n;

  // citizen_cohorts is intentionally not seeded here: Mongo should hold real
  // resident-persona-aggregate cohorts (population/build_neighbourhood_cohorts.py),
  // never synthetic fixtures. Fixture-mode TechTO still reads TRANSIT_COHORTS
  // from src/data/transit/cohorts.ts via the in-memory repository. socialContexts
  // had no live consumers beyond this seed path.

  n = 0;
  for (const scenario of listScenarios()) {
    await db.collection(COLLECTIONS.transitScenarios).updateOne(
      { scenarioId: scenario.id },
      {
        $set: {
          ...scenario,
          scenarioId: scenario.id,
          provenance: DEMO_PROVENANCE,
          updatedAt: now,
        },
      },
      { upsert: true },
    );
    n += 1;
  }
  upserted[COLLECTIONS.transitScenarios] = n;

  n = 0;
  for (const overlay of listStressOverlays()) {
    await db.collection(COLLECTIONS.stressOverlays).updateOne(
      { overlayId: overlay.id },
      {
        $set: {
          ...overlay,
          overlayId: overlay.id,
          provenance: DEMO_PROVENANCE,
          updatedAt: now,
        },
      },
      { upsert: true },
    );
    n += 1;
  }
  upserted[COLLECTIONS.stressOverlays] = n;

  const concert = getConcertEvent();
  await db.collection(COLLECTIONS.events).updateOne(
    { eventId: concert.id },
    {
      $set: {
        ...concert,
        eventId: concert.id,
        location: { type: "Point", coordinates: [-79.3791, 43.6435] },
        provenance: DEMO_PROVENANCE,
        updatedAt: now,
      },
    },
    { upsert: true },
  );
  const weather = getWeatherEvent();
  await db.collection(COLLECTIONS.events).updateOne(
    { eventId: weather.id },
    {
      $set: {
        ...weather,
        eventId: weather.id,
        type: "weather",
        provenance: DEMO_PROVENANCE,
        updatedAt: now,
      },
    },
    { upsert: true },
  );
  upserted[COLLECTIONS.events] = 2;

  n = 0;
  for (const incident of getServiceIncidents()) {
    await db.collection(COLLECTIONS.incidents).updateOne(
      { incidentId: incident.id },
      {
        $set: {
          ...incident,
          incidentId: incident.id,
          provenance: DEMO_PROVENANCE,
          updatedAt: now,
        },
      },
      { upsert: true },
    );
    n += 1;
  }
  upserted[COLLECTIONS.incidents] = n;

  n = 0;
  for (const record of SIMILAR_INTERVENTIONS) {
    await db.collection(COLLECTIONS.similarInterventions).updateOne(
      { interventionId: record.id },
      {
        $set: {
          ...record,
          interventionId: record.id,
          provenance: DEMO_PROVENANCE,
          updatedAt: now,
        },
      },
      { upsert: true },
    );
    n += 1;
  }
  upserted[COLLECTIONS.similarInterventions] = n;

  // Delay + fleet assumptions materialised per route for agent reads.
  n = 0;
  for (const route of network.routes) {
    const fleetByMode =
      route.mode === "subway"
        ? { vehiclesInService: 8, vehiclesInMaintenance: 1, spareVehicles: 2 }
        : route.mode === "streetcar"
          ? { vehiclesInService: 12, vehiclesInMaintenance: 2, spareVehicles: 3 }
          : { vehiclesInService: 5, vehiclesInMaintenance: 1, spareVehicles: 1 };
    await db.collection(COLLECTIONS.latestRouteState).updateOne(
      { routeId: route.id },
      {
        $set: {
          routeId: route.id,
          vehicleCapacity: route.vehicleCapacity,
          headwayMinutes: route.headwayMinutes,
          ...fleetByMode,
          delayHistory:
            route.id === "line-1"
              ? [
                  { dateLabel: "2026-07-10", delayMinutes: 4, cause: "signal_problem" },
                  { dateLabel: "2026-07-03", delayMinutes: 2, cause: "door_fault" },
                  { dateLabel: "2026-06-26", delayMinutes: 6, cause: "medical_emergency" },
                ]
              : route.id === "streetcar-501"
                ? [
                    { dateLabel: "2026-07-12", delayMinutes: 8, cause: "mechanical" },
                    { dateLabel: "2026-07-05", delayMinutes: 5, cause: "traffic_blockage" },
                  ]
                : [{ dateLabel: "2026-07-08", delayMinutes: 3, cause: "traffic_blockage" }],
          dataMode: "synthetic-fixture",
          provenance: DEMO_PROVENANCE,
          updatedAt: now,
        },
      },
      { upsert: true },
    );
    n += 1;
  }
  upserted[COLLECTIONS.latestRouteState] = n;

  // Searchable policy/knowledge stubs for Atlas Search / regex fallback.
  const docs = [
    {
      documentId: "doc-flagship-load-imbalance",
      title: "Union 16:06 / 16:12 load imbalance",
      body: "Dense arrivals before 16:06 deny boardings while 16:12 runs underused at Union Line 1.",
      tags: ["union", "line-1", "schedule", "load-imbalance"],
      documentType: "policy-note",
    },
    {
      documentId: "doc-concert-surge",
      title: "Scotiabank Arena concert surge stress test",
      body: "Combined event: 25% arrival surge, closed entrance, delayed departure, delayed streetcar.",
      tags: ["concert", "stress-test", "events"],
      documentType: "policy-note",
    },
  ];
  n = 0;
  for (const doc of docs) {
    await db.collection(COLLECTIONS.documents).updateOne(
      { documentId: doc.documentId },
      {
        $set: {
          ...doc,
          dataMode: "synthetic-fixture",
          provenance: DEMO_PROVENANCE,
          updatedAt: now,
        },
      },
      { upsert: true },
    );
    n += 1;
  }
  upserted[COLLECTIONS.documents] = n;

  return { database: db.databaseName, upserted };
}
