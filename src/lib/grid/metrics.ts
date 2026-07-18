import type { PhysicalTraceStep } from "@/lib/grid/validator";
import type { BatteryAsset, ConditionHour, SimulationMetrics } from "@/lib/grid/types";

/**
 * Placeholder degradation cost per MWh of cell-side throughput (charge + discharge),
 * representative of typical utility-scale LFP BESS assumptions used for this demo.
 * Not sourced from a live asset-health model.
 */
export const DEGRADATION_COST_CAD_PER_MWH_THROUGHPUT = 4;

export interface IntervalFinancials {
  energyRevenueCad: number;
  reserveRevenueCad: number;
  degradationCostCad: number;
  carbonAvoidedKg: number;
  netValueCad: number;
}

export function computeIntervalFinancials(
  step: PhysicalTraceStep,
  condition: ConditionHour,
  dtHours: number,
): IntervalFinancials {
  const gridChargeMwh = step.chargeMw * dtHours;
  const gridDischargeMwh = step.dischargeMw * dtHours;

  const energyRevenueCad =
    gridDischargeMwh * condition.priceCadPerMwh - gridChargeMwh * condition.priceCadPerMwh;
  const reserveRevenueCad = step.reserveMw * condition.reservePriceCadPerMwh * dtHours;
  const degradationCostCad =
    (step.chargeMwh + step.dischargeMwh) * DEGRADATION_COST_CAD_PER_MWH_THROUGHPUT;
  const carbonAvoidedKg =
    (step.dischargeMw - step.chargeMw) * dtHours * condition.marginalEmissionsKgPerMwh;
  const netValueCad = energyRevenueCad + reserveRevenueCad - degradationCostCad;

  return { energyRevenueCad, reserveRevenueCad, degradationCostCad, carbonAvoidedKg, netValueCad };
}

/**
 * Charging that happens in above-average combined wind+solar hours is treated as
 * "renewable captured" charging, a simple, explainable proxy rather than a real
 * marginal-generation attribution model.
 */
export function computeRenewableCapturedMwh(
  steps: PhysicalTraceStep[],
  conditions: ConditionHour[],
  dtHours: number,
): number {
  if (conditions.length === 0) {
    return 0;
  }
  const averageRenewableMw =
    conditions.reduce((sum, condition) => sum + condition.windMw + condition.solarMw, 0) /
    conditions.length;

  const conditionByHour = new Map(conditions.map((condition) => [condition.hour, condition]));

  let capturedMwh = 0;
  for (const step of steps) {
    const condition = conditionByHour.get(step.hour);
    if (!condition) continue;
    const renewableMw = condition.windMw + condition.solarMw;
    if (renewableMw > averageRenewableMw) {
      capturedMwh += step.chargeMw * dtHours;
    }
  }
  return capturedMwh;
}

export function aggregateMetrics(
  steps: PhysicalTraceStep[],
  financials: IntervalFinancials[],
  conditions: ConditionHour[],
  asset: BatteryAsset,
  dtHours: number,
): SimulationMetrics {
  let energyRevenueCad = 0;
  let reserveRevenueCad = 0;
  let degradationCostCad = 0;
  let carbonAvoidedKg = 0;
  let totalChargeMwh = 0;
  let totalDischargeMwh = 0;
  let minSocFraction = asset.startingSocFraction;
  let maxSocFraction = asset.startingSocFraction;

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    const financial = financials[i];
    energyRevenueCad += financial.energyRevenueCad;
    reserveRevenueCad += financial.reserveRevenueCad;
    degradationCostCad += financial.degradationCostCad;
    carbonAvoidedKg += financial.carbonAvoidedKg;
    totalChargeMwh += step.chargeMw * dtHours;
    totalDischargeMwh += step.dischargeMw * dtHours;
    minSocFraction = Math.min(minSocFraction, step.socFractionEnd);
    maxSocFraction = Math.max(maxSocFraction, step.socFractionEnd);
  }

  const finalSocFraction =
    steps.length > 0 ? steps[steps.length - 1].socFractionEnd : asset.startingSocFraction;
  const equivalentFullCycles =
    asset.usableEnergyMwh > 0
      ? (totalChargeMwh + totalDischargeMwh) / 2 / asset.usableEnergyMwh
      : 0;
  const renewableCapturedMwh = computeRenewableCapturedMwh(steps, conditions, dtHours);

  return {
    netValueCad: energyRevenueCad + reserveRevenueCad - degradationCostCad,
    energyRevenueCad,
    reserveRevenueCad,
    degradationCostCad,
    totalChargeMwh,
    totalDischargeMwh,
    equivalentFullCycles,
    carbonAvoidedKg,
    renewableCapturedMwh,
    minSocFraction,
    maxSocFraction,
    finalSocFraction,
  };
}
