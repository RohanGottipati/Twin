import type {
  BatteryAsset,
  BatteryThermalConfig,
  ConditionHour,
  ConstraintViolation,
  DispatchPlan,
} from "@/lib/grid/types";

const SOC_EPSILON = 1e-6;
const POWER_EPSILON = 1e-6;

export interface PhysicalTraceStep {
  hour: number;
  timestamp: string;
  chargeMw: number;
  dischargeMw: number;
  reserveMw: number;
  effectivePowerLimitMw: number;
  socFractionStart: number;
  socFractionEnd: number;
  socMwhEnd: number;
  chargeMwh: number;
  dischargeMwh: number;
}

export interface ValidationOutcome {
  violations: ConstraintViolation[];
  trace: PhysicalTraceStep[];
}

/**
 * Linear thermal derating: full rated power at/below warningTemperatureC,
 * down to deratingFractionAtMax once ambient reaches maxTemperatureC.
 */
export function computeThermalDeratingFraction(
  thermal: BatteryThermalConfig,
  ambientTemperatureC: number,
): number {
  if (ambientTemperatureC <= thermal.deratingStartTemperatureC) {
    return 1;
  }
  if (ambientTemperatureC >= thermal.maxTemperatureC) {
    return thermal.deratingFractionAtMax;
  }
  const span = thermal.maxTemperatureC - thermal.deratingStartTemperatureC;
  if (span <= 0) {
    return thermal.deratingFractionAtMax;
  }
  const progress = (ambientTemperatureC - thermal.deratingStartTemperatureC) / span;
  return 1 - progress * (1 - thermal.deratingFractionAtMax);
}

function chargeEfficiencyLeg(roundTripEfficiency: number): number {
  return Math.sqrt(roundTripEfficiency);
}

export function validateDispatchPlan(
  plan: DispatchPlan,
  asset: BatteryAsset,
  conditions: ConditionHour[],
): ValidationOutcome {
  const violations: ConstraintViolation[] = [];

  if (plan.assetId !== asset.id) {
    violations.push({
      code: "asset-mismatch",
      severity: "error",
      hour: -1,
      message: `Plan targets asset "${plan.assetId}" but was evaluated against "${asset.id}".`,
    });
    return { violations, trace: [] };
  }

  if (asset.status !== "available") {
    violations.push({
      code: "asset-unavailable",
      severity: "error",
      hour: -1,
      message: `Asset "${asset.id}" is not available (status: ${asset.status}); no dispatch plan can be executed.`,
    });
    return { violations, trace: [] };
  }

  if (plan.intervals.length !== conditions.length) {
    violations.push({
      code: "horizon-mismatch",
      severity: "error",
      hour: -1,
      message: `Plan has ${plan.intervals.length} intervals but the scenario horizon has ${conditions.length}.`,
    });
  }

  const dtHours = plan.intervalMinutes / 60;
  const efficiencyLeg = chargeEfficiencyLeg(asset.roundTripEfficiency);
  const usableEnergyMwh = asset.usableEnergyMwh;

  let socFraction = asset.startingSocFraction;
  let previousNetPowerMw = 0;
  let totalReserveMw = 0;
  const trace: PhysicalTraceStep[] = [];

  const stepCount = Math.min(plan.intervals.length, conditions.length);

  for (let i = 0; i < stepCount; i += 1) {
    const interval = plan.intervals[i];
    const condition = conditions[i];
    const hour = condition.hour;

    if (interval.timestamp !== condition.timestamp) {
      violations.push({
        code: "timestamp-mismatch",
        severity: "error",
        hour,
        message: `Interval ${i} timestamp "${interval.timestamp}" does not match expected "${condition.timestamp}".`,
      });
    }

    if (interval.chargeMw > 0 && interval.dischargeMw > 0) {
      violations.push({
        code: "simultaneous-charge-discharge",
        severity: "error",
        hour,
        message: `Interval at hour ${hour} charges and discharges at the same time.`,
      });
    }

    const thermalFraction = computeThermalDeratingFraction(
      asset.thermal,
      condition.ambientTemperatureC,
    );
    const effectivePowerLimitMw = condition.deratedRatedPowerMw * thermalFraction;

    if (interval.chargeMw > effectivePowerLimitMw + POWER_EPSILON) {
      violations.push({
        code: "charge-exceeds-limit",
        severity: "error",
        hour,
        message: `Charge of ${interval.chargeMw} MW exceeds the effective limit of ${effectivePowerLimitMw.toFixed(2)} MW at hour ${hour}.`,
      });
    }

    if (interval.dischargeMw > effectivePowerLimitMw + POWER_EPSILON) {
      violations.push({
        code: "discharge-exceeds-limit",
        severity: "error",
        hour,
        message: `Discharge of ${interval.dischargeMw} MW exceeds the effective limit of ${effectivePowerLimitMw.toFixed(2)} MW at hour ${hour}.`,
      });
    }

    const committedPowerMw = Math.max(interval.chargeMw, interval.dischargeMw) + interval.reserveMw;
    if (committedPowerMw > effectivePowerLimitMw + POWER_EPSILON) {
      violations.push({
        code: "reserve-exceeds-headroom",
        severity: "error",
        hour,
        message: `Dispatch plus reserve (${committedPowerMw.toFixed(2)} MW) exceeds the effective limit of ${effectivePowerLimitMw.toFixed(2)} MW at hour ${hour}.`,
      });
    }
    totalReserveMw += interval.reserveMw;

    const netPowerMw = interval.dischargeMw - interval.chargeMw;
    const rampMw = Math.abs(netPowerMw - previousNetPowerMw);
    if (rampMw > asset.maxRampMwPerInterval + POWER_EPSILON) {
      violations.push({
        code: "ramp-limit-exceeded",
        severity: "error",
        hour,
        message: `Net power changed by ${rampMw.toFixed(2)} MW at hour ${hour}, exceeding the ${asset.maxRampMwPerInterval} MW ramp limit.`,
      });
    }
    previousNetPowerMw = netPowerMw;

    const socFractionStart = socFraction;
    const chargeMwh = interval.chargeMw * efficiencyLeg * dtHours;
    const dischargeMwh = (interval.dischargeMw / efficiencyLeg) * dtHours;
    const socMwhStart = socFractionStart * usableEnergyMwh;
    const socMwhEnd = socMwhStart + chargeMwh - dischargeMwh;
    const socFractionEnd = socMwhEnd / usableEnergyMwh;

    if (socFractionEnd < asset.minSocFraction - SOC_EPSILON) {
      violations.push({
        code: "soc-below-minimum",
        severity: "error",
        hour,
        message: `State of charge would fall to ${(socFractionEnd * 100).toFixed(1)}% at hour ${hour}, below the ${(asset.minSocFraction * 100).toFixed(0)}% minimum.`,
      });
    }
    if (socFractionEnd > asset.maxSocFraction + SOC_EPSILON) {
      violations.push({
        code: "soc-above-maximum",
        severity: "error",
        hour,
        message: `State of charge would rise to ${(socFractionEnd * 100).toFixed(1)}% at hour ${hour}, above the ${(asset.maxSocFraction * 100).toFixed(0)}% maximum.`,
      });
    }

    trace.push({
      hour,
      timestamp: condition.timestamp,
      chargeMw: interval.chargeMw,
      dischargeMw: interval.dischargeMw,
      reserveMw: interval.reserveMw,
      effectivePowerLimitMw,
      socFractionStart,
      socFractionEnd,
      socMwhEnd,
      chargeMwh,
      dischargeMwh,
    });

    socFraction = socFractionEnd;
  }

  if (stepCount > 0) {
    const averageReserveMw = totalReserveMw / stepCount;
    if (averageReserveMw < asset.reserveRequirementMw) {
      violations.push({
        code: "reserve-below-target",
        severity: "warning",
        hour: -1,
        message: `Average committed reserve (${averageReserveMw.toFixed(1)} MW) is below the ${asset.reserveRequirementMw} MW target across the horizon.`,
      });
    }
  }

  return { violations, trace };
}
