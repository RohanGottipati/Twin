import { getStation } from "@/data/transit/network";
import { listCohorts, vulnerableCohorts } from "@/data/transit/cohorts";
import { StationQueue } from "@/lib/transit/queue";
import {
  computeEquityGap,
  computeLoadImbalance,
  estimateCarbonKg,
  estimateCarTripsFromDeniedBoardings,
  meanWaitMinutes,
  p90WaitMinutes,
  weightedCarSwitchProbability,
  type WeightedSample,
} from "@/lib/transit/metrics";
import type {
  DepartureLoad,
  QueuePoint,
  TransitIntervention,
  TransitScenario,
  TransitSimulationInput,
  TransitSimulationResult,
  TransitStressOverlay,
  Violation,
} from "@/lib/transit/schemas";

/**
 * The single deterministic authority for what a transit schedule
 * intervention does to riders (docs/twinto-implementation.md section 11).
 * Nothing from Backboard or FreeSolo ever bypasses this: every candidate,
 * and every stress-tested variant of an accepted candidate, is scored here
 * using only local, reproducible arithmetic over the fixtures in
 * src/data/transit.
 */

/** Queue length above capacity times this multiplier is treated as unsafe platform crowding. */
export const PLATFORM_SAFE_QUEUE_MULTIPLIER = 1.5;

/** A vehicle's physical crush capacity relative to its rated capacity; boosting capacity past this is rejected. */
export const CRUSH_CAPACITY_FRACTION = 1.3;

/** Load factor above which boarding is treated as infeasible for wheelchair and stroller users. */
export const ACCESSIBILITY_CROWDING_LOAD_FACTOR = 0.95;

/** Minimum comfortable buffer, in minutes, between a subway arrival and a connecting departure. */
export const TRANSFER_WINDOW_MINUTES = 3;

/** Synthetic assumed number of riders per window who rely on a given transfer route at the scenario's station. */
export const TRANSFER_DEMAND_PER_ROUTE = 40;

/** Synthetic relative operating-cost units, not real TTC dollar figures; used only to rank candidates against each other. */
const OPERATING_COST_UNITS = {
  shiftDepartureMinute: 1,
  addTrip: 40,
  capacityBoostPerSeat: 0.05,
  entranceClosureMitigation: 15,
  holdMinute: 3,
  retimeFeederMinute: 2,
} as const;

function makeViolation(code: string, severity: Violation["severity"], minute: number, message: string): Violation {
  return { code, severity, minute, message };
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

// ---------------------------------------------------------------------------
// Clock and window helpers
// ---------------------------------------------------------------------------

function clockToMinutesOfDay(clock: string): number {
  const [hours, minutes] = clock.split(":").map(Number);
  return hours * 60 + minutes;
}

function windowStartClock(windowStartIso: string): string {
  const date = new Date(windowStartIso);
  const offsetMatch = windowStartIso.match(/([+-]\d{2}):(\d{2})$/);
  if (!offsetMatch) {
    return `${date.getUTCHours().toString().padStart(2, "0")}:${date.getUTCMinutes().toString().padStart(2, "0")}`;
  }
  // The ISO string already carries an explicit local offset, so its literal
  // HH:MM digits are the local clock time; reading them directly avoids any
  // ambiguity from the host runtime's own timezone.
  const timeMatch = windowStartIso.match(/T(\d{2}):(\d{2})/);
  if (!timeMatch) {
    return "00:00";
  }
  return `${timeMatch[1]}:${timeMatch[2]}`;
}

function departureClockToMinuteOffset(windowStartIso: string, departureClock: string): number {
  return clockToMinutesOfDay(departureClock) - clockToMinutesOfDay(windowStartClock(windowStartIso));
}

function minuteOffsetToClock(windowStartIso: string, minuteOffset: number): string {
  const startMinutes = clockToMinutesOfDay(windowStartClock(windowStartIso));
  const total = startMinutes + minuteOffset;
  const wrapped = ((total % 1440) + 1440) % 1440;
  const hours = Math.floor(wrapped / 60).toString().padStart(2, "0");
  const minutes = (wrapped % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

function windowLengthMinutes(window: TransitScenario["window"]): number {
  const startMs = new Date(window.start).getTime();
  const endMs = new Date(window.end).getTime();
  return Math.max(0, Math.round((endMs - startMs) / 60_000));
}

// ---------------------------------------------------------------------------
// Departure resolution
// ---------------------------------------------------------------------------

interface ResolvedDeparture {
  id: string;
  scheduledMinute: number;
  actualMinute: number;
  capacity: number;
}

function resolveDepartures(
  scenario: TransitScenario,
  intervention: TransitIntervention | null,
  stressOverlay: TransitStressOverlay | null,
): { departures: ResolvedDeparture[]; violations: Violation[] } {
  const violations: Violation[] = [];
  const departures = new Map<string, ResolvedDeparture>();

  for (const clock of scenario.baselineDepartures) {
    const minute = departureClockToMinuteOffset(scenario.window.start, clock);
    departures.set(clock, {
      id: clock,
      scheduledMinute: minute,
      actualMinute: minute,
      capacity: scenario.vehicleCapacity,
    });
  }

  const unknownDeparture = (id: string) =>
    makeViolation("unknown-departure-id", "error", 0, `Intervention references unknown departure "${id}".`);

  if (intervention) {
    for (const action of intervention.actions) {
      switch (action.type) {
        case "shift_departure_minutes": {
          const departure = departures.get(action.departureId);
          if (!departure) {
            violations.push(unknownDeparture(action.departureId));
            break;
          }
          departure.scheduledMinute += action.deltaMinutes;
          departure.actualMinute += action.deltaMinutes;
          break;
        }
        case "hold_departure": {
          const departure = departures.get(action.departureId);
          if (!departure) {
            violations.push(unknownDeparture(action.departureId));
            break;
          }
          departure.actualMinute += action.holdMinutes;
          break;
        }
        case "capacity_boost": {
          const departure = departures.get(action.departureId);
          if (!departure) {
            violations.push(unknownDeparture(action.departureId));
            break;
          }
          departure.capacity += action.extraCapacity;
          break;
        }
        case "add_trip": {
          const after = departures.get(action.afterDepartureId);
          if (!after) {
            violations.push(unknownDeparture(action.afterDepartureId));
            break;
          }
          const newMinute = after.actualMinute + action.offsetMinutes;
          const newId = `${action.afterDepartureId}+${action.offsetMinutes}`;
          departures.set(newId, {
            id: newId,
            scheduledMinute: newMinute,
            actualMinute: newMinute,
            capacity: action.vehicleCapacity,
          });
          break;
        }
        case "entrance_closure":
        case "retime_feeder":
          // Handled by resolveEntranceCapacityMultiplier and resolveTransferDelayMinutes respectively.
          break;
        default:
          break;
      }
    }
  }

  if (stressOverlay) {
    for (const delay of stressOverlay.departureDelays) {
      const departure = departures.get(delay.departureId);
      if (departure) {
        departure.actualMinute += delay.delayMinutes;
      }
    }
  }

  for (const departure of departures.values()) {
    const crushLimit = scenario.vehicleCapacity * CRUSH_CAPACITY_FRACTION;
    if (departure.capacity > crushLimit) {
      violations.push(
        makeViolation(
          "capacity-boost-exceeds-crush-limit",
          "error",
          departure.actualMinute,
          `Departure "${departure.id}" capacity of ${departure.capacity} exceeds the vehicle crush limit of ${crushLimit.toFixed(0)}.`,
        ),
      );
    }
  }

  const sorted = [...departures.values()].sort((a, b) => a.actualMinute - b.actualMinute);
  for (let i = 1; i < sorted.length; i += 1) {
    const headway = sorted[i].actualMinute - sorted[i - 1].actualMinute;
    if (headway <= 0) {
      violations.push(
        makeViolation(
          "negative-headway",
          "error",
          sorted[i].actualMinute,
          `Departure "${sorted[i].id}" does not follow departure "${sorted[i - 1].id}" with positive headway.`,
        ),
      );
    }
  }

  return { departures: sorted, violations };
}

// ---------------------------------------------------------------------------
// Arrivals and entrance capacity
// ---------------------------------------------------------------------------

function resolveEffectiveArrivals(
  scenario: TransitScenario,
  stressOverlay: TransitStressOverlay | null,
): Map<number, number> {
  const arrivals = new Map<number, number>();
  for (const point of scenario.arrivalsByMinute) {
    const minute = departureClockToMinuteOffset(scenario.window.start, point.minute);
    arrivals.set(minute, point.arrivals);
  }

  if (!stressOverlay || stressOverlay.arrivalSurgeMultiplier === 1) {
    return arrivals;
  }

  const from = stressOverlay.surgeFromMinute ?? 0;
  const to = stressOverlay.surgeToMinute ?? windowLengthMinutes(scenario.window);

  for (const [minute, count] of arrivals) {
    if (minute >= from && minute <= to) {
      arrivals.set(minute, Math.round(count * stressOverlay.arrivalSurgeMultiplier));
    }
  }

  return arrivals;
}

interface EntranceCapacityResolution {
  multiplier: number;
  closureCount: number;
  inaccessibleClosureCount: number;
}

function resolveEntranceCapacityMultiplier(
  scenario: TransitScenario,
  intervention: TransitIntervention | null,
  stressOverlay: TransitStressOverlay | null,
): EntranceCapacityResolution {
  let multiplier = 1;
  let closureCount = 0;
  let inaccessibleClosureCount = 0;

  const applyClosure = (stationId: string, fraction: number) => {
    if (stationId !== scenario.stationId) return;
    multiplier *= 1 - fraction;
    closureCount += 1;
    const station = getStation(stationId);
    if (!station || !station.alternateAccessibleEntrance) {
      inaccessibleClosureCount += 1;
    }
  };

  if (intervention) {
    for (const action of intervention.actions) {
      if (action.type === "entrance_closure") {
        applyClosure(action.stationId, action.capacityReductionFraction);
      }
    }
  }

  if (stressOverlay) {
    for (const closure of stressOverlay.entranceClosures) {
      applyClosure(closure.stationId, closure.capacityReductionFraction);
    }
  }

  return { multiplier: Math.max(0, multiplier), closureCount, inaccessibleClosureCount };
}

// ---------------------------------------------------------------------------
// Transfers
// ---------------------------------------------------------------------------

function resolveTransferDelayMinutes(
  intervention: TransitIntervention | null,
  stressOverlay: TransitStressOverlay | null,
): number {
  let delta = 0;
  if (intervention) {
    for (const action of intervention.actions) {
      if (action.type === "retime_feeder") {
        delta += Math.abs(action.deltaMinutes);
      }
    }
  }
  if (stressOverlay) {
    for (const delay of stressOverlay.connectingDelays) {
      delta += Math.abs(delay.delayMinutes);
    }
  }
  return delta;
}

function estimateMissedTransfers(scenario: TransitScenario, transferDelayMinutes: number): number {
  if (scenario.transferRouteIds.length === 0) return 0;
  if (transferDelayMinutes <= TRANSFER_WINDOW_MINUTES) return 0;
  const overrun = transferDelayMinutes - TRANSFER_WINDOW_MINUTES;
  const missedFraction = Math.min(1, overrun / (TRANSFER_WINDOW_MINUTES * 2));
  return Math.round(scenario.transferRouteIds.length * TRANSFER_DEMAND_PER_ROUTE * missedFraction);
}

// ---------------------------------------------------------------------------
// Operating cost
// ---------------------------------------------------------------------------

function computeOperatingCostScore(intervention: TransitIntervention | null): number {
  if (!intervention) return 0;
  let cost = 0;
  for (const action of intervention.actions) {
    switch (action.type) {
      case "shift_departure_minutes":
        cost += Math.abs(action.deltaMinutes) * OPERATING_COST_UNITS.shiftDepartureMinute;
        break;
      case "add_trip":
        cost += OPERATING_COST_UNITS.addTrip;
        break;
      case "capacity_boost":
        cost += action.extraCapacity * OPERATING_COST_UNITS.capacityBoostPerSeat;
        break;
      case "entrance_closure":
        cost += OPERATING_COST_UNITS.entranceClosureMitigation;
        break;
      case "hold_departure":
        cost += action.holdMinutes * OPERATING_COST_UNITS.holdMinute;
        break;
      case "retime_feeder":
        cost += Math.abs(action.deltaMinutes) * OPERATING_COST_UNITS.retimeFeederMinute;
        break;
      default:
        break;
    }
  }
  return round(cost, 2);
}

// ---------------------------------------------------------------------------
// Minute-tick queue simulation
// ---------------------------------------------------------------------------

interface RawDepartureLoad {
  departureId: string;
  scheduledMinute: number;
  actualMinute: number;
  capacity: number;
  boarded: number;
  denied: number;
  loadFactor: number;
}

interface QueueSimulationOutcome {
  departureLoads: RawDepartureLoad[];
  queueTrace: { minute: number; queueLength: number }[];
  waitSamples: WeightedSample[];
  strandedAtWindowEnd: number;
}

function runQueueSimulation(
  windowLength: number,
  effectiveArrivals: Map<number, number>,
  departures: ResolvedDeparture[],
  entranceCapacityMultiplier: number,
): QueueSimulationOutcome {
  const departuresByMinute = new Map<number, ResolvedDeparture[]>();
  for (const departure of departures) {
    const list = departuresByMinute.get(departure.actualMinute) ?? [];
    list.push(departure);
    departuresByMinute.set(departure.actualMinute, list);
  }

  const queue = new StationQueue();
  const queueTrace: { minute: number; queueLength: number }[] = [];
  const departureLoads: RawDepartureLoad[] = [];
  const waitSamples: WeightedSample[] = [];

  for (let minute = 0; minute < windowLength; minute += 1) {
    const arriving = effectiveArrivals.get(minute) ?? 0;
    queue.arrive(minute, arriving);
    queueTrace.push({ minute, queueLength: queue.length });

    const departuresNow = departuresByMinute.get(minute);
    if (!departuresNow) continue;

    for (const departure of departuresNow) {
      const effectiveCapacity = Math.max(0, Math.floor(departure.capacity * entranceCapacityMultiplier));
      const { outcome, waitSamples: consumed } = queue.board(effectiveCapacity, minute);
      waitSamples.push(...consumed);

      departureLoads.push({
        departureId: departure.id,
        scheduledMinute: departure.scheduledMinute,
        actualMinute: departure.actualMinute,
        capacity: effectiveCapacity,
        boarded: outcome.boarded,
        denied: outcome.denied,
        loadFactor: effectiveCapacity > 0 ? outcome.boarded / effectiveCapacity : 0,
      });
    }
  }

  waitSamples.push(...queue.drainRemaining(windowLength));

  return { departureLoads, queueTrace, waitSamples, strandedAtWindowEnd: queue.length };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function simulateTransit(input: TransitSimulationInput): TransitSimulationResult {
  const { scenario, intervention, stressOverlay, seed } = input;
  const windowLength = windowLengthMinutes(scenario.window);

  const { departures, violations: departureViolations } = resolveDepartures(scenario, intervention, stressOverlay);
  const effectiveArrivals = resolveEffectiveArrivals(scenario, stressOverlay);
  const { multiplier: entranceMultiplier, inaccessibleClosureCount } = resolveEntranceCapacityMultiplier(
    scenario,
    intervention,
    stressOverlay,
  );

  const { departureLoads: rawLoads, queueTrace: rawQueueTrace, waitSamples, strandedAtWindowEnd } =
    runQueueSimulation(windowLength, effectiveArrivals, departures, entranceMultiplier);

  const violations: Violation[] = [...departureViolations];

  const peakQueueLength = rawQueueTrace.reduce((max, point) => Math.max(max, point.queueLength), 0);
  const safeQueueThreshold = scenario.vehicleCapacity * PLATFORM_SAFE_QUEUE_MULTIPLIER;
  if (peakQueueLength > safeQueueThreshold) {
    const peakPoint = rawQueueTrace.find((point) => point.queueLength === peakQueueLength);
    violations.push(
      makeViolation(
        "platform-crowding-exceeded",
        "warning",
        peakPoint?.minute ?? 0,
        `Peak platform queue of ${peakQueueLength} exceeds the safe threshold of ${safeQueueThreshold.toFixed(0)}.`,
      ),
    );
  }

  if (strandedAtWindowEnd > 0) {
    violations.push(
      makeViolation(
        "residual-queue-at-window-end",
        "warning",
        windowLength,
        `${strandedAtWindowEnd} passenger(s) remain queued when the observation window ends.`,
      ),
    );
  }

  const deniedBoardings = rawLoads.reduce((sum, load) => sum + load.denied, 0);

  const highCrowdingDepartures = rawLoads.filter(
    (load) => load.loadFactor > ACCESSIBILITY_CROWDING_LOAD_FACTOR,
  ).length;
  const accessibilityFailures = inaccessibleClosureCount + highCrowdingDepartures;

  if (inaccessibleClosureCount > 0) {
    violations.push(
      makeViolation(
        "accessibility-entrance-unavailable",
        "error",
        0,
        `${inaccessibleClosureCount} entrance closure(s) leave no accessible alternate entrance at "${scenario.stationId}".`,
      ),
    );
  }
  if (highCrowdingDepartures > 0) {
    violations.push(
      makeViolation(
        "accessibility-crowding-barrier",
        "warning",
        0,
        `${highCrowdingDepartures} departure(s) exceed the crowding threshold at which mobility-device boarding becomes infeasible.`,
      ),
    );
  }

  const transferDelayMinutes = resolveTransferDelayMinutes(intervention, stressOverlay);
  const missedTransfers = estimateMissedTransfers(scenario, transferDelayMinutes);
  if (missedTransfers > 0) {
    violations.push(
      makeViolation(
        "missed-transfer-risk",
        "warning",
        0,
        `Estimated ${missedTransfers} missed transfer(s) on connecting route(s) ${scenario.transferRouteIds.join(", ")}.`,
      ),
    );
  }

  const meanWait = meanWaitMinutes(waitSamples);
  const p90Wait = p90WaitMinutes(waitSamples);
  const loadImbalance = computeLoadImbalance(rawLoads.map((load) => load.loadFactor));

  const allCohorts = listCohorts();
  const vulnerable = vulnerableCohorts();
  const equityGap = computeEquityGap(meanWait, vulnerable, allCohorts);
  const carSwitchProbability = weightedCarSwitchProbability(allCohorts);
  const estimatedCarTrips = estimateCarTripsFromDeniedBoardings(deniedBoardings, carSwitchProbability);
  const estimatedCarbonKg = estimateCarbonKg(estimatedCarTrips);
  const operatingCostScore = computeOperatingCostScore(intervention);

  const departureLoads: DepartureLoad[] = rawLoads.map((load) => ({
    departureId: load.departureId,
    scheduledTime: minuteOffsetToClock(scenario.window.start, load.scheduledMinute),
    actualTime: minuteOffsetToClock(scenario.window.start, load.actualMinute),
    capacity: load.capacity,
    boarded: load.boarded,
    denied: load.denied,
    loadFactor: round(load.loadFactor, 3),
  }));

  const queueTrace: QueuePoint[] = rawQueueTrace.map((point) => ({
    minute: point.minute,
    clockTime: minuteOffsetToClock(scenario.window.start, point.minute),
    stationId: scenario.stationId,
    queueLength: point.queueLength,
  }));

  const valid = !violations.some((violation) => violation.severity === "error");

  return {
    schemaVersion: 1,
    scenarioId: scenario.id,
    interventionId: intervention?.id ?? null,
    stressOverlayId: stressOverlay?.id ?? null,
    seed,
    dataMode: "synthetic-fixture",
    valid,
    violations,
    departureLoads,
    queueTrace,
    metrics: {
      meanWaitMinutes: round(meanWait, 2),
      p90WaitMinutes: round(p90Wait, 2),
      deniedBoardings,
      loadImbalance: round(loadImbalance, 3),
      missedTransfers,
      estimatedCarTrips,
      estimatedCarbonKg: round(estimatedCarbonKg, 2),
      accessibilityFailures,
      equityGap: round(equityGap, 3),
      operatingCostScore,
    },
  };
}
