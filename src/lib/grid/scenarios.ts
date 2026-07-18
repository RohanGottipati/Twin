import {
  MARKET_DEMO_DATE,
  MARKET_INTERVAL_MINUTES,
  getBaselineMarketHours,
  getBaselineRenewableHours,
  requireScenario,
} from "@/lib/grid/fixtures";
import type {
  BatteryAsset,
  ConditionHour,
  MarketHour,
  RenewableHour,
  ScenarioAdjustment,
  ScenarioConditions,
} from "@/lib/grid/types";

function appliesToHour(hours: number[] | undefined, hour: number): boolean {
  return !hours || hours.includes(hour);
}

function hourTimestamp(demoDate: string, hour: number): string {
  const paddedHour = hour.toString().padStart(2, "0");
  return `${demoDate}T${paddedHour}:00:00.000Z`;
}

function buildConditionHours(
  market: MarketHour[],
  renewable: RenewableHour[],
  asset: BatteryAsset,
  adjustment: ScenarioAdjustment,
): ConditionHour[] {
  const renewableByHour = new Map(renewable.map((entry) => [entry.hour, entry]));

  return market.map((marketHour) => {
    const renewableHour = renewableByHour.get(marketHour.hour);
    if (!renewableHour) {
      throw new Error(`Missing renewable fixture data for hour ${marketHour.hour}`);
    }

    const priceMultiplier = appliesToHour(adjustment.priceHours, marketHour.hour)
      ? adjustment.priceMultiplier ?? 1
      : 1;
    const demandMultiplier = appliesToHour(adjustment.demandHours, marketHour.hour)
      ? adjustment.demandMultiplier ?? 1
      : 1;
    const windMultiplier = appliesToHour(adjustment.windHours, marketHour.hour)
      ? adjustment.windMultiplier ?? 1
      : 1;
    const solarMultiplier = appliesToHour(adjustment.solarHours, marketHour.hour)
      ? adjustment.solarMultiplier ?? 1
      : 1;
    const temperatureAdd = appliesToHour(adjustment.temperatureHours, marketHour.hour)
      ? adjustment.temperatureAddC ?? 0
      : 0;
    const deratingFraction = appliesToHour(adjustment.deratingHours, marketHour.hour)
      ? adjustment.deratingPercent ?? 0
      : 0;

    return {
      hour: marketHour.hour,
      timestamp: hourTimestamp(MARKET_DEMO_DATE, marketHour.hour),
      priceCadPerMwh: round2(marketHour.priceCadPerMwh * priceMultiplier),
      demandMw: round2(marketHour.demandMw * demandMultiplier),
      reservePriceCadPerMwh: marketHour.reservePriceCadPerMwh,
      marginalEmissionsKgPerMwh: marketHour.marginalEmissionsKgPerMwh,
      windMw: round2(Math.max(0, renewableHour.windMw * windMultiplier)),
      solarMw: round2(Math.max(0, renewableHour.solarMw * solarMultiplier)),
      ambientTemperatureC: round2(renewableHour.ambientTemperatureC + temperatureAdd),
      deratedRatedPowerMw: round2(asset.ratedPowerMw * (1 - deratingFraction)),
    };
  });
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function mergeAdjustments(
  visible: ScenarioAdjustment,
  hidden: ScenarioAdjustment | null,
): ScenarioAdjustment {
  if (!hidden) {
    return visible;
  }
  return {
    windMultiplier: (visible.windMultiplier ?? 1) * (hidden.windMultiplier ?? 1),
    windHours: hidden.windHours ?? visible.windHours,
    solarMultiplier: (visible.solarMultiplier ?? 1) * (hidden.solarMultiplier ?? 1),
    solarHours: hidden.solarHours ?? visible.solarHours,
    demandMultiplier: (visible.demandMultiplier ?? 1) * (hidden.demandMultiplier ?? 1),
    demandHours: hidden.demandHours ?? visible.demandHours,
    priceMultiplier: (visible.priceMultiplier ?? 1) * (hidden.priceMultiplier ?? 1),
    priceHours: hidden.priceHours ?? visible.priceHours,
    temperatureAddC: (visible.temperatureAddC ?? 0) + (hidden.temperatureAddC ?? 0),
    temperatureHours: hidden.temperatureHours ?? visible.temperatureHours,
    deratingPercent: hidden.deratingPercent ?? visible.deratingPercent,
    deratingHours: hidden.deratingHours ?? visible.deratingHours,
  };
}

/**
 * Resolves a scenario against the baseline fixtures into two views:
 * `visibleHours` (what planning assistants are shown) and `actualHours`
 * (visible + hidden stress, used only by the simulator and stress tests).
 * Hidden stress adjustments are intentionally never returned to callers that
 * build assistant prompts.
 */
export function resolveScenarioConditions(
  scenarioId: string,
  asset: BatteryAsset,
): ScenarioConditions {
  const scenario = requireScenario(scenarioId);
  const market = getBaselineMarketHours();
  const renewable = getBaselineRenewableHours();

  const visibleHours = buildConditionHours(market, renewable, asset, scenario.visible);
  const actualAdjustment = mergeAdjustments(scenario.visible, scenario.hiddenStress);
  const actualHours = buildConditionHours(market, renewable, asset, actualAdjustment);

  return {
    scenarioId,
    demoDate: MARKET_DEMO_DATE,
    intervalMinutes: MARKET_INTERVAL_MINUTES,
    visibleHours,
    actualHours,
    hiddenStressDescription: scenario.hiddenStressDescription,
  };
}
