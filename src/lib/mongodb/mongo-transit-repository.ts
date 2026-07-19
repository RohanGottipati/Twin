import type { TransitCohortFixture } from "@/data/transit/cohorts";
import type {
  ConcertEventFixture,
  EventContextBundle,
  ServiceIncidentFixture,
  WeatherEventFixture,
} from "@/data/transit/events";
import type { NeighbourhoodFixture } from "@/data/transit/neighbourhoods";
import type {
  NetworkSnapshot,
  TransitMode,
  TransitRouteFixture,
  TransitStationFixture,
  TransitStopFixture,
} from "@/data/transit/network";
import type { SimilarInterventionRecord } from "@/data/transit/similar-policies";
import { getMongoDb } from "@/lib/mongodb/client";
import { COLLECTIONS } from "@/lib/mongodb/collections";
import { simulateTransit, TRANSFER_DEMAND_PER_ROUTE } from "@/lib/transit/simulator";
import type { ArrivalPoint, DepartureLoad, TransitScenario, TransitStressOverlay } from "@/lib/transit/schemas";
import type {
  AccessibilityConstraintSummary,
  DelayHistoryEntry,
  FleetAvailabilityEntry,
  NeighbourhoodDemographicSummary,
  OriginDestinationFlow,
  RouteScheduleEntry,
  StopCrowdingSnapshot,
  TransferDemandSnapshot,
  TransitRepository,
} from "@/lib/transit/repository";

const DEFAULT_REPOSITORY_SEED = 20260718;

function mostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best = values[0] ?? "unknown";
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/**
 * TransitRepository backed by documents loaded from MongoDB Atlas.
 * After `warm()`, reads are served from an in-process cache populated from
 * Atlas (not from TypeScript fixture modules). Simulator computations still
 * run locally; inputs and persisted outputs come from / go to Mongo.
 */
export class MongoTransitRepository implements TransitRepository {
  private warmed = false;
  private network!: NetworkSnapshot;
  private scenarios = new Map<string, TransitScenario>();
  private stressOverlays = new Map<string, TransitStressOverlay>();
  private cohorts: TransitCohortFixture[] = [];
  private neighbourhoods: NeighbourhoodFixture[] = [];
  private concert!: ConcertEventFixture;
  private weather!: WeatherEventFixture;
  private incidents: ServiceIncidentFixture[] = [];
  private similar: SimilarInterventionRecord[] = [];
  private delayByRoute = new Map<string, DelayHistoryEntry[]>();
  private fleetByRoute = new Map<string, FleetAvailabilityEntry>();
  private capacityByRoute = new Map<string, number>();

  async warm(): Promise<void> {
    if (this.warmed) return;
    const db = await getMongoDb();

    const [places, routes, stops, scenarioDocs, overlayDocs, cohortDocs, neighbourhoodDocs, eventDocs, incidentDocs, similarDocs, routeStates] =
      await Promise.all([
        db.collection(COLLECTIONS.places).find({ kind: "station" }).toArray(),
        db.collection(COLLECTIONS.transitRoutes).find({}).toArray(),
        db.collection(COLLECTIONS.transitStops).find({}).toArray(),
        db.collection(COLLECTIONS.transitScenarios).find({}).toArray(),
        db.collection(COLLECTIONS.stressOverlays).find({}).toArray(),
        db.collection(COLLECTIONS.citizenCohorts).find({}).toArray(),
        db.collection(COLLECTIONS.neighbourhoods).find({}).toArray(),
        db.collection(COLLECTIONS.events).find({}).toArray(),
        db.collection(COLLECTIONS.incidents).find({}).toArray(),
        db.collection(COLLECTIONS.similarInterventions).find({}).toArray(),
        db.collection(COLLECTIONS.latestRouteState).find({}).toArray(),
      ]);

    if (routes.length === 0 || stops.length === 0 || scenarioDocs.length === 0) {
      throw new Error(
        "MongoDB TechTO collections are empty. Run `npm run mongo:bootstrap` to create indexes and seed demo fixtures.",
      );
    }
    if (cohortDocs.length === 0) {
      throw new Error(
        "MongoDB citizen_cohorts collection is empty. Run `npm run mongo:bootstrap` (synthetic fixture) or " +
          "`uv run python -m population.build_neighbourhood_cohorts` (real resident-persona aggregate) to seed it.",
      );
    }

    const stations: TransitStationFixture[] = places.map((doc) => {
      const coords = (doc.location?.coordinates ?? [0, 0]) as [number, number];
      return {
        id: String(doc.placeId),
        name: String(doc.name),
        lng: coords[0],
        lat: coords[1],
        hasElevator: Boolean(doc.hasElevator),
        alternateAccessibleEntrance: Boolean(doc.alternateAccessibleEntrance),
      };
    });

    const routeFixtures: TransitRouteFixture[] = routes.map((doc) => ({
      id: String(doc.routeId),
      name: String(doc.name),
      mode: doc.mode as TransitMode,
      color: String(doc.color),
      stopIds: doc.stopIds as string[],
      vehicleCapacity: Number(doc.vehicleCapacity),
      headwayMinutes: Number(doc.headwayMinutes),
    }));

    const stopFixtures: TransitStopFixture[] = stops.map((doc) => {
      const coords = (doc.location?.coordinates ?? [0, 0]) as [number, number];
      return {
        id: String(doc.stopId),
        routeId: String(doc.routeId),
        name: String(doc.name),
        lng: coords[0],
        lat: coords[1],
        sequence: Number(doc.sequence),
        stationId: doc.stationId ? String(doc.stationId) : undefined,
      };
    });

    this.network = {
      dataMode: "synthetic-fixture",
      generatedAt: new Date().toISOString(),
      stations,
      routes: routeFixtures,
      stops: stopFixtures,
    };

    this.scenarios.clear();
    for (const doc of scenarioDocs) {
      const scenario: TransitScenario = {
        id: String(doc.scenarioId ?? doc.id),
        label: String(doc.label),
        description: String(doc.description),
        dataMode: "synthetic-fixture",
        window: doc.window as TransitScenario["window"],
        baselineDepartures: doc.baselineDepartures as string[],
        stationId: String(doc.stationId),
        routeId: String(doc.routeId),
        arrivalsByMinute: doc.arrivalsByMinute as TransitScenario["arrivalsByMinute"],
        vehicleCapacity: Number(doc.vehicleCapacity),
        transferRouteIds: doc.transferRouteIds as string[],
        tags: doc.tags as string[],
      };
      this.scenarios.set(scenario.id, scenario);
    }

    this.stressOverlays.clear();
    for (const doc of overlayDocs) {
      const overlay: TransitStressOverlay = {
        id: String(doc.overlayId ?? doc.id),
        label: String(doc.label),
        description: String(doc.description),
        dataMode: "synthetic-fixture",
        arrivalSurgeMultiplier: Number(doc.arrivalSurgeMultiplier),
        entranceClosures: doc.entranceClosures as TransitStressOverlay["entranceClosures"],
        departureDelays: doc.departureDelays as TransitStressOverlay["departureDelays"],
        connectingDelays: doc.connectingDelays as TransitStressOverlay["connectingDelays"],
      };
      this.stressOverlays.set(overlay.id, overlay);
    }

    this.cohorts = cohortDocs.map((doc) => {
      const raw = doc as Record<string, unknown>;
      return {
        id: String(raw.cohortId ?? raw.id),
        label: String(raw.label),
        weight: Number(raw.weight),
        personaCount: raw.personaCount === undefined ? undefined : Number(raw.personaCount),
        homeZoneId: String(raw.homeZoneId),
        primaryDestinationZoneId: String(raw.primaryDestinationZoneId),
        ageBand: String(raw.ageBand),
        incomeBand: raw.incomeBand as TransitCohortFixture["incomeBand"],
        occupationGroup: raw.occupationGroup === undefined ? undefined : String(raw.occupationGroup),
        workSchedule:
          raw.workSchedule === undefined ? undefined : (raw.workSchedule as TransitCohortFixture["workSchedule"]),
        vehicleAccessProbability: Number(raw.vehicleAccessProbability),
        transitPassProbability: Number(raw.transitPassProbability),
        scheduleFlexibility: raw.scheduleFlexibility === undefined ? undefined : Number(raw.scheduleFlexibility),
        mobilityNeeds: raw.mobilityNeeds as string[],
        sensitivity: raw.sensitivity as TransitCohortFixture["sensitivity"],
        baselineModeShare: raw.baselineModeShare as TransitCohortFixture["baselineModeShare"],
        dataMode: (raw.dataMode as TransitCohortFixture["dataMode"]) ?? "synthetic-fixture",
      };
    });

    this.neighbourhoods = neighbourhoodDocs.map((doc) => ({
      id: String(doc.neighbourhoodId),
      name: String(doc.name),
      center: doc.center as [number, number],
      bounds: doc.bounds as [number, number, number, number],
      tags: doc.tags as string[],
      growthProxy: doc.growthProxy as NeighbourhoodFixture["growthProxy"],
      landUse: String(doc.landUse),
      underservedAfter22: Boolean(doc.underservedAfter22),
    }));

    const concertDoc = eventDocs.find((doc) => doc.type === "concert");
    const weatherDoc = eventDocs.find((doc) => doc.type === "weather" || doc.condition);
    if (!concertDoc || !weatherDoc) {
      throw new Error("MongoDB events collection is missing concert/weather demo documents. Re-run mongo:bootstrap.");
    }
    this.concert = {
      id: String(concertDoc.eventId),
      venue: String(concertDoc.venue),
      title: String(concertDoc.title),
      type: "concert",
      nearestStationId: String(concertDoc.nearestStationId),
      startTime: String(concertDoc.startTime),
      endTime: String(concertDoc.endTime),
      expectedAttendance: Number(concertDoc.expectedAttendance),
      surgeMultiplier: Number(concertDoc.surgeMultiplier),
      description: String(concertDoc.description),
      dataMode: "synthetic-fixture",
    };
    this.weather = {
      id: String(weatherDoc.eventId),
      condition: weatherDoc.condition as WeatherEventFixture["condition"],
      precipitationMmPerHour: Number(weatherDoc.precipitationMmPerHour),
      temperatureC: Number(weatherDoc.temperatureC),
      walkingToleranceMultiplier: Number(weatherDoc.walkingToleranceMultiplier),
      waitToleranceMultiplier: Number(weatherDoc.waitToleranceMultiplier),
      description: String(weatherDoc.description),
      dataMode: "synthetic-fixture",
    };

    this.incidents = incidentDocs.map((doc) => ({
      id: String(doc.incidentId),
      routeId: String(doc.routeId),
      type: doc.type as ServiceIncidentFixture["type"],
      delayMinutes: Number(doc.delayMinutes),
      affectedStationIds: doc.affectedStationIds as string[],
      description: String(doc.description),
      dataMode: "synthetic-fixture",
    }));

    this.similar = similarDocs.map((doc) => ({
      id: String(doc.interventionId ?? doc.id),
      title: String(doc.title),
      interventionType: String(doc.interventionType),
      tags: doc.tags as string[],
      summary: String(doc.summary),
      outcome: String(doc.outcome),
      dateLabel: String(doc.dateLabel),
      dataMode: "synthetic-fixture",
    }));

    this.delayByRoute.clear();
    this.fleetByRoute.clear();
    this.capacityByRoute.clear();
    for (const state of routeStates) {
      const routeId = String(state.routeId);
      this.capacityByRoute.set(routeId, Number(state.vehicleCapacity));
      this.fleetByRoute.set(routeId, {
        routeId,
        vehiclesInService: Number(state.vehiclesInService),
        vehiclesInMaintenance: Number(state.vehiclesInMaintenance),
        spareVehicles: Number(state.spareVehicles),
        dataMode: "synthetic-fixture",
      });
      const history = (state.delayHistory as Array<{ dateLabel: string; delayMinutes: number; cause: string }>) ?? [];
      this.delayByRoute.set(
        routeId,
        history.map((entry) => ({
          routeId,
          dateLabel: entry.dateLabel,
          delayMinutes: entry.delayMinutes,
          cause: entry.cause,
          dataMode: "synthetic-fixture",
        })),
      );
    }

    this.warmed = true;
  }

  private assertWarm(): void {
    if (!this.warmed) {
      throw new Error("MongoTransitRepository.warm() must be awaited before use.");
    }
  }

  getStorageLayer(): "mongodb" {
    return "mongodb";
  }

  getNetworkSnapshot(): NetworkSnapshot {
    this.assertWarm();
    return this.network;
  }

  getScenario(scenarioId: string): TransitScenario | undefined {
    this.assertWarm();
    return this.scenarios.get(scenarioId);
  }

  listScenarios(): TransitScenario[] {
    this.assertWarm();
    return [...this.scenarios.values()];
  }

  getStressOverlay(overlayId: string): TransitStressOverlay | undefined {
    this.assertWarm();
    return this.stressOverlays.get(overlayId);
  }

  listStressOverlays(): TransitStressOverlay[] {
    this.assertWarm();
    return [...this.stressOverlays.values()];
  }

  listCohorts(): TransitCohortFixture[] {
    this.assertWarm();
    return this.cohorts;
  }

  listNeighbourhoods(): NeighbourhoodFixture[] {
    this.assertWarm();
    return this.neighbourhoods;
  }

  searchNeighbourhoods(query?: string, tags?: string[], limit = 5): NeighbourhoodFixture[] {
    this.assertWarm();
    const q = query?.trim().toLowerCase() ?? "";
    const tagSet = new Set((tags ?? []).map((t) => t.toLowerCase()));
    return this.neighbourhoods
      .filter((n) => {
        const nameOk = !q || n.name.toLowerCase().includes(q) || n.id.includes(q.replace(/\s+/g, "-"));
        const tagsOk = tagSet.size === 0 || n.tags.some((t) => tagSet.has(t));
        return nameOk && tagsOk;
      })
      .slice(0, limit);
  }

  requireNeighbourhood(neighbourhoodId: string): NeighbourhoodFixture {
    this.assertWarm();
    const found = this.neighbourhoods.find((n) => n.id === neighbourhoodId);
    if (!found) throw new Error(`Unknown neighbourhood id: "${neighbourhoodId}".`);
    return found;
  }

  private requireScenario(scenarioId: string): TransitScenario {
    const scenario = this.getScenario(scenarioId);
    if (!scenario) throw new Error(`Unknown transit scenario id: "${scenarioId}".`);
    return scenario;
  }

  private requireRoute(routeId: string): TransitRouteFixture {
    const route = this.network.routes.find((r) => r.id === routeId);
    if (!route) throw new Error(`Unknown route id: "${routeId}".`);
    return route;
  }

  private requireStation(stationId: string): TransitStationFixture {
    const station = this.network.stations.find((s) => s.id === stationId);
    if (!station) throw new Error(`Unknown station id: "${stationId}".`);
    return station;
  }

  getRouteSchedule(routeId: string, scenarioId: string): RouteScheduleEntry[] {
    this.assertWarm();
    const scenario = this.requireScenario(scenarioId);
    if (routeId === scenario.routeId) {
      return scenario.baselineDepartures.map((clock) => ({
        departureId: clock,
        scheduledTime: clock,
        routeId,
      }));
    }
    const route = this.requireRoute(routeId);
    const windowMinutes = Math.round(
      (new Date(scenario.window.end).getTime() - new Date(scenario.window.start).getTime()) / 60_000,
    );
    const entries: RouteScheduleEntry[] = [];
    for (let minute = 0; minute < windowMinutes; minute += route.headwayMinutes) {
      entries.push({ departureId: `${routeId}-t${minute}`, scheduledTime: `+${minute}m`, routeId });
    }
    return entries;
  }

  getDepartureLoads(scenarioId: string, interventionId?: string | null): DepartureLoad[] {
    this.assertWarm();
    if (interventionId) {
      throw new Error(
        `MongoTransitRepository.getDepartureLoads only resolves baseline state. Simulate intervention "${interventionId}" with simulateTransit.`,
      );
    }
    const scenario = this.requireScenario(scenarioId);
    const result = simulateTransit({
      schemaVersion: 1,
      scenario,
      intervention: null,
      stressOverlay: null,
      seed: DEFAULT_REPOSITORY_SEED,
      cohorts: this.cohorts,
    });
    return result.departureLoads;
  }

  getPassengerArrivals(scenarioId: string): ArrivalPoint[] {
    this.assertWarm();
    return this.requireScenario(scenarioId).arrivalsByMinute;
  }

  getOriginDestinationFlows(zoneId?: string): OriginDestinationFlow[] {
    this.assertWarm();
    const flows = new Map<string, OriginDestinationFlow>();
    for (const cohort of this.cohorts) {
      const key = `${cohort.homeZoneId}->${cohort.primaryDestinationZoneId}`;
      const existing = flows.get(key);
      if (existing) {
        existing.estimatedTrips += cohort.weight;
      } else {
        flows.set(key, {
          originZoneId: cohort.homeZoneId,
          destinationZoneId: cohort.primaryDestinationZoneId,
          estimatedTrips: cohort.weight,
          dataMode: "synthetic-fixture",
        });
      }
    }
    const all = [...flows.values()];
    if (!zoneId) return all;
    return all.filter((flow) => flow.originZoneId === zoneId || flow.destinationZoneId === zoneId);
  }

  getStopCrowding(stopId: string, scenarioId: string): StopCrowdingSnapshot {
    this.assertWarm();
    const scenario = this.requireScenario(scenarioId);
    const result = simulateTransit({
      schemaVersion: 1,
      scenario,
      intervention: null,
      stressOverlay: null,
      seed: DEFAULT_REPOSITORY_SEED,
      cohorts: this.cohorts,
    });
    const peakQueueLength = result.queueTrace.reduce((max, point) => Math.max(max, point.queueLength), 0);
    const peakLoad = result.departureLoads.reduce((max, load) => Math.max(max, load.loadFactor), 0);
    return {
      stopId,
      stationId: scenario.stationId,
      routeId: scenario.routeId,
      peakQueueLength,
      loadFactorAtPeak: peakLoad,
      dataMode: "synthetic-fixture",
    };
  }

  getTransferDemand(routeId: string): TransferDemandSnapshot {
    this.assertWarm();
    const connectingAtScenarioIds = [...this.scenarios.values()]
      .filter((scenario) => scenario.transferRouteIds.includes(routeId))
      .map((scenario) => scenario.id);
    return {
      routeId,
      connectingAtScenarioIds,
      estimatedTransferringPassengers: connectingAtScenarioIds.length * TRANSFER_DEMAND_PER_ROUTE,
      dataMode: "synthetic-fixture",
    };
  }

  getDelayHistory(routeId: string): DelayHistoryEntry[] {
    this.assertWarm();
    return this.delayByRoute.get(routeId) ?? [];
  }

  getVehicleCapacity(routeId: string): number {
    this.assertWarm();
    return this.capacityByRoute.get(routeId) ?? this.requireRoute(routeId).vehicleCapacity;
  }

  getFleetAvailability(routeId: string): FleetAvailabilityEntry {
    this.assertWarm();
    const existing = this.fleetByRoute.get(routeId);
    if (existing) return existing;
    return {
      routeId,
      vehiclesInService: 0,
      vehiclesInMaintenance: 0,
      spareVehicles: 0,
      dataMode: "synthetic-fixture",
    };
  }

  getNeighbourhoodDemographics(zoneId?: string): NeighbourhoodDemographicSummary[] {
    this.assertWarm();
    const byZone = new Map<string, TransitCohortFixture[]>();
    for (const cohort of this.cohorts) {
      const list = byZone.get(cohort.homeZoneId) ?? [];
      list.push(cohort);
      byZone.set(cohort.homeZoneId, list);
    }
    const summaries: NeighbourhoodDemographicSummary[] = [...byZone.entries()].map(([zone, cohorts]) => ({
      zoneId: zone,
      cohortIds: cohorts.map((cohort) => cohort.id),
      totalWeight: cohorts.reduce((sum, cohort) => sum + cohort.weight, 0),
      dominantIncomeBand: mostCommon(cohorts.map((cohort) => cohort.incomeBand)),
      dataMode: "synthetic-fixture",
    }));
    if (!zoneId) return summaries;
    return summaries.filter((summary) => summary.zoneId === zoneId);
  }

  getAccessibilityConstraints(stationId: string): AccessibilityConstraintSummary {
    this.assertWarm();
    const station = this.requireStation(stationId);
    const mobilityNeedCohortWeight = this.cohorts
      .filter((cohort) => cohort.mobilityNeeds.length > 0)
      .reduce((sum, cohort) => sum + cohort.weight, 0);
    return {
      stationId: station.id,
      hasElevator: station.hasElevator,
      alternateAccessibleEntrance: station.alternateAccessibleEntrance,
      mobilityNeedCohortWeight,
      dataMode: "synthetic-fixture",
    };
  }

  getEventContext(): EventContextBundle {
    this.assertWarm();
    return { concert: this.concert, weather: this.weather, incidents: this.incidents };
  }

  getWeatherContext(): WeatherEventFixture {
    this.assertWarm();
    return this.weather;
  }

  getServiceIncidents(): ServiceIncidentFixture[] {
    this.assertWarm();
    return this.incidents;
  }

  findSimilarInterventions(query: {
    interventionType?: string;
    tags?: string[];
    limit?: number;
  }): SimilarInterventionRecord[] {
    this.assertWarm();
    const limit = query.limit ?? 5;
    const tagSet = new Set((query.tags ?? []).map((t) => t.toLowerCase()));
    return this.similar
      .filter((record) => {
        const typeOk = !query.interventionType || record.interventionType === query.interventionType;
        const tagsOk = tagSet.size === 0 || record.tags.some((t) => tagSet.has(t.toLowerCase()));
        return typeOk && tagsOk;
      })
      .slice(0, limit);
  }
}
