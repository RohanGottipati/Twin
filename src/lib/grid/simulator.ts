import { computeIntervalFinancials, aggregateMetrics } from "@/lib/grid/metrics";
import { validateDispatchPlan } from "@/lib/grid/validator";
import type {
  BatteryAsset,
  ConditionHour,
  DispatchPlan,
  IntervalTrace,
  SimulationResult,
} from "@/lib/grid/types";

/**
 * The single deterministic authority for whether a dispatch plan is physically
 * and financially sound. Nothing from Backboard ever bypasses this: every
 * candidate, and every stress-tested variant of an accepted plan, is scored
 * here using only local, reproducible arithmetic.
 */
export function simulateDispatchPlan(
  plan: DispatchPlan,
  asset: BatteryAsset,
  conditions: ConditionHour[],
): SimulationResult {
  const { violations, trace: physicalTrace } = validateDispatchPlan(plan, asset, conditions);
  const dtHours = plan.intervalMinutes / 60;
  const conditionByHour = new Map(conditions.map((condition) => [condition.hour, condition]));

  const financials = physicalTrace.map((step) => {
    const condition = conditionByHour.get(step.hour);
    if (!condition) {
      throw new Error(`Missing condition data for hour ${step.hour} during simulation.`);
    }
    return computeIntervalFinancials(step, condition, dtHours);
  });

  const trace: IntervalTrace[] = physicalTrace.map((step, index) => ({
    hour: step.hour,
    timestamp: step.timestamp,
    chargeMw: step.chargeMw,
    dischargeMw: step.dischargeMw,
    reserveMw: step.reserveMw,
    socFractionStart: step.socFractionStart,
    socFractionEnd: step.socFractionEnd,
    socMwhEnd: step.socMwhEnd,
    revenueCad: financials[index].energyRevenueCad,
    reserveRevenueCad: financials[index].reserveRevenueCad,
    degradationCostCad: financials[index].degradationCostCad,
    carbonAvoidedKg: financials[index].carbonAvoidedKg,
    netValueCad: financials[index].netValueCad,
  }));

  const metrics = aggregateMetrics(physicalTrace, financials, conditions, asset, dtHours);
  const valid = !violations.some((violation) => violation.severity === "error");

  return {
    assetId: asset.id,
    scenarioId: plan.scenarioId,
    valid,
    violations,
    metrics,
    trace,
  };
}
