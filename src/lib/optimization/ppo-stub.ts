/**
 * PPO stub for TechTO numeric schedule tuning (§12.2–12.4).
 * Not a trained policy: returns a heuristic action suggestion so the
 * Simulation and Optimization agent has a stable interface before a real
 * Gymnasium / Stable-Baselines3 loop is wired in services/transit-core.
 */

export interface PpoScheduleState {
  arrivalHistogram: number[];
  departureTimes: string[];
  vehicleLoads: number[];
  queueLength: number;
  eventDemandMultiplier: number;
}

export interface PpoScheduleAction {
  shiftDepartureAMinutes: number;
  shiftDepartureBMinutes: number;
  holdMinutes: number;
  retimeFeederMinutes: number;
  addEventOnlyTrip: boolean;
  source: "ppo-stub-heuristic";
}

export function suggestPpoAction(state: PpoScheduleState): PpoScheduleAction {
  const peakIdx = state.arrivalHistogram.reduce(
    (best, value, index, arr) => (value > arr[best] ? index : best),
    0,
  );
  const earlyHeavy = peakIdx < state.arrivalHistogram.length / 2;
  return {
    shiftDepartureAMinutes: earlyHeavy ? 2 : 0,
    shiftDepartureBMinutes: earlyHeavy ? 1 : -1,
    holdMinutes: state.queueLength > 80 ? 1 : 0,
    retimeFeederMinutes: state.eventDemandMultiplier > 1 ? 2 : 0,
    addEventOnlyTrip: state.eventDemandMultiplier >= 1.2,
    source: "ppo-stub-heuristic",
  };
}
