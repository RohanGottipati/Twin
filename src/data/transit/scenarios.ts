import {
  transitScenarioSchema,
  transitStressOverlaySchema,
  type ArrivalPoint,
  type TransitScenario,
  type TransitStressOverlay,
} from "@/lib/transit/schemas";

/**
 * Synthetic transit scenario and stress overlay fixtures for the TechTO
 * flagship demonstration (docs/techto-implementation.md section 2). Every
 * scenario and overlay is parsed through its zod schema at module load, so a
 * malformed fixture fails fast at build time rather than surfacing as a
 * confusing runtime error deep in the simulator.
 */

export const FLAGSHIP_SCENARIO_ID = "departure-406-412";
export const CONCERT_SURGE_STRESS_OVERLAY_ID = "concert-surge-scotiabank";

function addMinutesToClock(clock: string, delta: number): string {
  const [hours, minutes] = clock.split(":").map(Number);
  const total = hours * 60 + minutes + delta;
  const wrapped = ((total % 1440) + 1440) % 1440;
  const outHours = Math.floor(wrapped / 60)
    .toString()
    .padStart(2, "0");
  const outMinutes = (wrapped % 60).toString().padStart(2, "0");
  return `${outHours}:${outMinutes}`;
}

function buildArrivalCurve(windowStartClock: string, arrivalsByMinute: number[]): ArrivalPoint[] {
  return arrivalsByMinute.map((arrivals, offset) => ({
    minute: addMinutesToClock(windowStartClock, offset),
    arrivals,
  }));
}

/**
 * Flagship arrival pattern, built in four labeled phases across the 45
 * minute window (15:45 to 16:30):
 *   A. 15:45-15:59 (15 min): a low, gently ramping off-peak trickle.
 *   B. 16:00-16:05 (6 min): a dense pre-departure surge, chosen so that
 *      combined with phase A it exceeds the 800-seat vehicle capacity by
 *      about 120 riders, causing the 16:06 departure to deny boardings.
 *   C. 16:06-16:11 (6 min): a much lighter wave, so the riders denied at
 *      16:06 plus this wave still leave the 16:12 departure well under
 *      capacity, the load imbalance this scenario is named for.
 *   D. 16:12-16:29 (18 min): a steady light trickle for the remainder of
 *      the observation window.
 */
const FLAGSHIP_ARRIVALS_BY_MINUTE = [
  ...[6, 6, 6, 7, 7, 7, 8, 8, 8, 9, 9, 9, 10, 10, 10], // Phase A
  ...[60, 90, 120, 150, 180, 200], // Phase B
  ...[15, 15, 18, 18, 20, 20], // Phase C
  ...new Array(18).fill(10), // Phase D
];

const FLAGSHIP_SCENARIO: TransitScenario = transitScenarioSchema.parse({
  id: FLAGSHIP_SCENARIO_ID,
  label: "4:06 / 4:12 Load Imbalance",
  description:
    "Union station, Line 1 southbound platform. Dense passenger arrivals build up in the six minutes before the " +
    "16:06 departure, denying boardings, while the 16:12 departure that follows runs comparatively underused.",
  dataMode: "synthetic-fixture",
  window: {
    start: "2026-07-18T15:45:00-04:00",
    end: "2026-07-18T16:30:00-04:00",
  },
  baselineDepartures: ["16:06", "16:12"],
  stationId: "union",
  routeId: "line-1",
  arrivalsByMinute: buildArrivalCurve("15:45", FLAGSHIP_ARRIVALS_BY_MINUTE),
  vehicleCapacity: 800,
  transferRouteIds: ["streetcar-501", "bus-6a"],
  tags: ["flagship", "load-imbalance", "peak"],
});

/**
 * A secondary, lower-stakes scenario on the 501 Queen streetcar, used to
 * exercise the ranker and repository across more than one route and mode.
 * The imbalance here is mild by design: a modest post-work ridership bump,
 * not the flagship's overload.
 */
const STREETCAR_MIDDAY_SCENARIO: TransitScenario = transitScenarioSchema.parse({
  id: "streetcar-midday-queen",
  label: "Queen Street Midday Bunching",
  description:
    "Queen & University stop, 501 Queen streetcar. A modest midday ridership bump ahead of the first scheduled " +
    "car, well short of the flagship's overload but useful for comparing interventions across modes.",
  dataMode: "synthetic-fixture",
  window: {
    start: "2026-07-18T12:00:00-04:00",
    end: "2026-07-18T12:30:00-04:00",
  },
  baselineDepartures: ["12:08", "12:16"],
  stationId: "osgoode",
  routeId: "streetcar-501",
  arrivalsByMinute: buildArrivalCurve("12:00", [
    ...[4, 4, 5, 5, 5, 5, 6, 6], // 12:00-12:07
    ...[10, 12, 14, 16, 18, 18, 16, 14], // 12:08-12:15, medium wave
    ...new Array(14).fill(4), // 12:16-12:29
  ]),
  vehicleCapacity: 130,
  transferRouteIds: ["line-1"],
  tags: ["secondary", "streetcar", "midday"],
});

const TRANSIT_SCENARIOS: TransitScenario[] = [FLAGSHIP_SCENARIO, STREETCAR_MIDDAY_SCENARIO];

export function listScenarios(): TransitScenario[] {
  return TRANSIT_SCENARIOS;
}

export function getScenario(scenarioId: string): TransitScenario | undefined {
  return TRANSIT_SCENARIOS.find((scenario) => scenario.id === scenarioId);
}

export function requireScenario(scenarioId: string): TransitScenario {
  const scenario = getScenario(scenarioId);
  if (!scenario) {
    throw new Error(`Unknown transit scenario id: "${scenarioId}"`);
  }
  return scenario;
}

/**
 * The stress overlay for the flagship demo's extenuating-circumstances test
 * (docs/techto-implementation.md section 2.5): a concert at Scotiabank
 * Arena, layered as a 25% arrival surge plus a closed Union entrance plus a
 * delayed departure plus a delayed connecting streetcar. Applied on top of
 * a candidate intervention by lib/transit/stress-tests.ts, never on its own.
 */
const CONCERT_SURGE_STRESS_OVERLAY: TransitStressOverlay = transitStressOverlaySchema.parse({
  id: CONCERT_SURGE_STRESS_OVERLAY_ID,
  label: "Scotiabank Arena Concert Surge",
  description:
    "Post-concert release near Union station: a citywide 25% arrival surge, one closed entrance, a 3 minute " +
    "departure delay, and a delayed connecting streetcar, combined to stress-test a candidate schedule change.",
  dataMode: "synthetic-fixture",
  arrivalSurgeMultiplier: 1.25,
  entranceClosures: [{ stationId: "union", entranceId: "union-bay-concourse", capacityReductionFraction: 0.3 }],
  departureDelays: [{ departureId: "16:12", delayMinutes: 3 }],
  connectingDelays: [{ routeId: "streetcar-501", delayMinutes: 4 }],
});

const TRANSIT_STRESS_OVERLAYS: TransitStressOverlay[] = [CONCERT_SURGE_STRESS_OVERLAY];

export function listStressOverlays(): TransitStressOverlay[] {
  return TRANSIT_STRESS_OVERLAYS;
}

export function getStressOverlay(stressOverlayId: string): TransitStressOverlay | undefined {
  return TRANSIT_STRESS_OVERLAYS.find((overlay) => overlay.id === stressOverlayId);
}

export function requireStressOverlay(stressOverlayId: string): TransitStressOverlay {
  const overlay = getStressOverlay(stressOverlayId);
  if (!overlay) {
    throw new Error(`Unknown transit stress overlay id: "${stressOverlayId}"`);
  }
  return overlay;
}
