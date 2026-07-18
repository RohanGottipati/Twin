import {
  getVehicleCapacity as getFixtureVehicleCapacity,
  getNetworkSnapshot,
  requireRoute,
  requireStation,
  type NetworkSnapshot,
  type TransitMode,
} from "@/data/transit/network";
import { listCohorts, type TransitCohortFixture } from "@/data/transit/cohorts";
import {
  getScenario,
  getStressOverlay,
  listScenarios,
  listStressOverlays,
  requireScenario,
} from "@/data/transit/scenarios";
import {
  getConcertEvent,
  getServiceIncidents,
  getWeatherEvent,
  type EventContextBundle,
  type ServiceIncidentFixture,
  type WeatherEventFixture,
} from "@/data/transit/events";
import {
  listNeighbourhoods,
  requireNeighbourhood,
  searchNeighbourhoods,
  type NeighbourhoodFixture,
} from "@/data/transit/neighbourhoods";
import {
  findSimilarInterventions as findSimilarInterventionFixtures,
  type SimilarInterventionRecord,
} from "@/data/transit/similar-policies";
import { simulateTransit, TRANSFER_DEMAND_PER_ROUTE } from "@/lib/transit/simulator";
import type { ArrivalPoint, DepartureLoad, TransitScenario, TransitStressOverlay } from "@/lib/transit/schemas";

/**
 * Read-side data access for the TwinTO transit domain (backs the
 * get_* Backboard tools in docs/twinto-implementation.md section 13.6).
 * Implementations: `FixtureTransitRepository` (local TS modules) and
 * `MongoTransitRepository` (Atlas-backed cache). Both serve synthetic demo
 * data with provenance; neither is a live TTC feed.
 */

const DEFAULT_REPOSITORY_SEED = 20260718;

export interface RouteScheduleEntry {
  departureId: string;
  scheduledTime: string;
  routeId: string;
}

export interface OriginDestinationFlow {
  originZoneId: string;
  destinationZoneId: string;
  estimatedTrips: number;
  dataMode: "synthetic-fixture";
}

export interface StopCrowdingSnapshot {
  stopId: string;
  stationId: string;
  routeId: string;
  peakQueueLength: number;
  loadFactorAtPeak: number;
  dataMode: "synthetic-fixture";
}

export interface TransferDemandSnapshot {
  routeId: string;
  connectingAtScenarioIds: string[];
  estimatedTransferringPassengers: number;
  dataMode: "synthetic-fixture";
}

export interface DelayHistoryEntry {
  routeId: string;
  dateLabel: string;
  delayMinutes: number;
  cause: string;
  dataMode: "synthetic-fixture";
}

export interface FleetAvailabilityEntry {
  routeId: string;
  vehiclesInService: number;
  vehiclesInMaintenance: number;
  spareVehicles: number;
  dataMode: "synthetic-fixture";
}

export interface NeighbourhoodDemographicSummary {
  zoneId: string;
  cohortIds: string[];
  totalWeight: number;
  dominantIncomeBand: string;
  dataMode: "synthetic-fixture";
}

export interface AccessibilityConstraintSummary {
  stationId: string;
  hasElevator: boolean;
  alternateAccessibleEntrance: boolean;
  mobilityNeedCohortWeight: number;
  dataMode: "synthetic-fixture";
}

export type RepositoryStorageLayer = "fixture" | "mongodb";

export interface TransitRepository {
  getStorageLayer(): RepositoryStorageLayer;
  getNetworkSnapshot(): NetworkSnapshot;
  getScenario(scenarioId: string): TransitScenario | undefined;
  listScenarios(): TransitScenario[];
  getStressOverlay(overlayId: string): TransitStressOverlay | undefined;
  listStressOverlays(): TransitStressOverlay[];
  listCohorts(): TransitCohortFixture[];
  listNeighbourhoods(): NeighbourhoodFixture[];
  searchNeighbourhoods(query?: string, tags?: string[], limit?: number): NeighbourhoodFixture[];
  requireNeighbourhood(neighbourhoodId: string): NeighbourhoodFixture;
  getRouteSchedule(routeId: string, scenarioId: string): RouteScheduleEntry[];
  getDepartureLoads(scenarioId: string, interventionId?: string | null): DepartureLoad[];
  getPassengerArrivals(scenarioId: string): ArrivalPoint[];
  getOriginDestinationFlows(zoneId?: string): OriginDestinationFlow[];
  getStopCrowding(stopId: string, scenarioId: string): StopCrowdingSnapshot;
  getTransferDemand(routeId: string): TransferDemandSnapshot;
  getDelayHistory(routeId: string): DelayHistoryEntry[];
  getVehicleCapacity(routeId: string): number;
  getFleetAvailability(routeId: string): FleetAvailabilityEntry;
  getNeighbourhoodDemographics(zoneId?: string): NeighbourhoodDemographicSummary[];
  getAccessibilityConstraints(stationId: string): AccessibilityConstraintSummary;
  getEventContext(): EventContextBundle;
  getWeatherContext(): WeatherEventFixture;
  getServiceIncidents(): ServiceIncidentFixture[];
  findSimilarInterventions(query: {
    interventionType?: string;
    tags?: string[];
    limit?: number;
  }): SimilarInterventionRecord[];
}

/** Synthetic delay-history assumptions per route mode; not a real TTC delay log. */
const DELAY_HISTORY_BY_ROUTE: Record<string, DelayHistoryEntry[]> = {
  "line-1": [
    { routeId: "line-1", dateLabel: "2026-07-10", delayMinutes: 4, cause: "signal_problem", dataMode: "synthetic-fixture" },
    { routeId: "line-1", dateLabel: "2026-07-03", delayMinutes: 2, cause: "door_fault", dataMode: "synthetic-fixture" },
    { routeId: "line-1", dateLabel: "2026-06-26", delayMinutes: 6, cause: "medical_emergency", dataMode: "synthetic-fixture" },
  ],
  "streetcar-501": [
    { routeId: "streetcar-501", dateLabel: "2026-07-12", delayMinutes: 8, cause: "mechanical", dataMode: "synthetic-fixture" },
    { routeId: "streetcar-501", dateLabel: "2026-07-05", delayMinutes: 5, cause: "traffic_blockage", dataMode: "synthetic-fixture" },
  ],
  "bus-6a": [
    { routeId: "bus-6a", dateLabel: "2026-07-08", delayMinutes: 3, cause: "traffic_blockage", dataMode: "synthetic-fixture" },
  ],
};

/** Synthetic fleet-availability assumptions keyed by mode, not a live TTC fleet management feed. */
const FLEET_AVAILABILITY_BY_MODE: Record<TransitMode, { inService: number; maintenance: number; spare: number }> = {
  subway: { inService: 8, maintenance: 1, spare: 2 },
  streetcar: { inService: 12, maintenance: 2, spare: 3 },
  bus: { inService: 5, maintenance: 1, spare: 1 },
};

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

export class FixtureTransitRepository implements TransitRepository {
  getStorageLayer(): RepositoryStorageLayer {
    return "fixture";
  }

  getNetworkSnapshot(): NetworkSnapshot {
    return getNetworkSnapshot();
  }

  getScenario(scenarioId: string): TransitScenario | undefined {
    return getScenario(scenarioId);
  }

  listScenarios(): TransitScenario[] {
    return listScenarios();
  }

  getStressOverlay(overlayId: string): TransitStressOverlay | undefined {
    return getStressOverlay(overlayId);
  }

  listStressOverlays(): TransitStressOverlay[] {
    return listStressOverlays();
  }

  listCohorts(): TransitCohortFixture[] {
    return listCohorts();
  }

  listNeighbourhoods(): NeighbourhoodFixture[] {
    return listNeighbourhoods();
  }

  searchNeighbourhoods(query?: string, tags?: string[], limit = 5): NeighbourhoodFixture[] {
    return searchNeighbourhoods(query, tags, limit);
  }

  requireNeighbourhood(neighbourhoodId: string): NeighbourhoodFixture {
    return requireNeighbourhood(neighbourhoodId);
  }

  getRouteSchedule(routeId: string, scenarioId: string): RouteScheduleEntry[] {
    const scenario = requireScenario(scenarioId);
    if (routeId === scenario.routeId) {
      return scenario.baselineDepartures.map((clock) => ({
        departureId: clock,
        scheduledTime: clock,
        routeId,
      }));
    }

    // routeId is not the scenario's primary route: fall back to a synthetic,
    // evenly spaced schedule derived from the route's nominal headway, since
    // no fixture carries a full timetable for every route in every scenario.
    const route = requireRoute(routeId);
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
    if (interventionId) {
      throw new Error(
        `FixtureTransitRepository.getDepartureLoads only resolves the baseline (no intervention) state from ` +
          `fixtures. Simulate intervention "${interventionId}" with simulateTransit and read its own ` +
          `departureLoads instead.`,
      );
    }
    const scenario = requireScenario(scenarioId);
    const result = simulateTransit({
      schemaVersion: 1,
      scenario,
      intervention: null,
      stressOverlay: null,
      seed: DEFAULT_REPOSITORY_SEED,
    });
    return result.departureLoads;
  }

  getPassengerArrivals(scenarioId: string): ArrivalPoint[] {
    return requireScenario(scenarioId).arrivalsByMinute;
  }

  getOriginDestinationFlows(zoneId?: string): OriginDestinationFlow[] {
    const flows = new Map<string, OriginDestinationFlow>();
    for (const cohort of listCohorts()) {
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
    const scenario = requireScenario(scenarioId);
    const result = simulateTransit({
      schemaVersion: 1,
      scenario,
      intervention: null,
      stressOverlay: null,
      seed: DEFAULT_REPOSITORY_SEED,
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
    const connectingAtScenarioIds = listScenarios()
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
    return DELAY_HISTORY_BY_ROUTE[routeId] ?? [];
  }

  getVehicleCapacity(routeId: string): number {
    return getFixtureVehicleCapacity(routeId);
  }

  getFleetAvailability(routeId: string): FleetAvailabilityEntry {
    const route = requireRoute(routeId);
    const availability = FLEET_AVAILABILITY_BY_MODE[route.mode];
    return {
      routeId,
      vehiclesInService: availability.inService,
      vehiclesInMaintenance: availability.maintenance,
      spareVehicles: availability.spare,
      dataMode: "synthetic-fixture",
    };
  }

  getNeighbourhoodDemographics(zoneId?: string): NeighbourhoodDemographicSummary[] {
    const byZone = new Map<string, TransitCohortFixture[]>();
    for (const cohort of listCohorts()) {
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
    const station = requireStation(stationId);
    const mobilityNeedCohortWeight = listCohorts()
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
    return {
      concert: getConcertEvent(),
      weather: getWeatherEvent(),
      incidents: getServiceIncidents(),
    };
  }

  getWeatherContext(): WeatherEventFixture {
    return getWeatherEvent();
  }

  getServiceIncidents(): ServiceIncidentFixture[] {
    return getServiceIncidents();
  }

  findSimilarInterventions(query: {
    interventionType?: string;
    tags?: string[];
    limit?: number;
  }): SimilarInterventionRecord[] {
    return findSimilarInterventionFixtures(query);
  }
}

export class TransitRepositoryConfigError extends Error {}

let cachedRepository: TransitRepository | null = null;
let warmPromise: Promise<TransitRepository> | null = null;

/**
 * Resolves the active repository from `TWINTO_REPOSITORY_PROVIDER`
 * (`fixture` | `mongo`). Unknown values throw rather than silently falling
 * back, so a misconfigured live deploy fails loudly instead of quietly
 * serving TypeScript modules as if they were Atlas state.
 */
export async function getTransitRepository(): Promise<TransitRepository> {
  if (cachedRepository) return cachedRepository;
  if (warmPromise) return warmPromise;

  warmPromise = (async () => {
    const provider = process.env.TWINTO_REPOSITORY_PROVIDER?.trim().toLowerCase() || "fixture";

    if (provider === "fixture") {
      cachedRepository = new FixtureTransitRepository();
      return cachedRepository;
    }

    if (provider === "mongo" || provider === "mongodb") {
      const { MongoTransitRepository } = await import("@/lib/mongodb/mongo-transit-repository");
      const repo = new MongoTransitRepository();
      await repo.warm();
      cachedRepository = repo;
      return cachedRepository;
    }

    throw new TransitRepositoryConfigError(
      `Unknown TWINTO_REPOSITORY_PROVIDER "${provider}". Supported: "fixture", "mongo".`,
    );
  })().finally(() => {
    warmPromise = null;
  });

  return warmPromise;
}

/** Test-only hook to force a fresh repository instance on the next getTransitRepository() call. */
export function resetTransitRepositoryCache(): void {
  cachedRepository = null;
  warmPromise = null;
}
