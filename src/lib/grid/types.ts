export type AssetStatus = "available" | "unavailable" | "maintenance";

export interface BatteryThermalConfig {
  warningTemperatureC: number;
  maxTemperatureC: number;
  deratingStartTemperatureC: number;
  /** Fraction (0-1) of rated power still available once ambient temperature reaches maxTemperatureC. */
  deratingFractionAtMax: number;
}

export interface BatteryAsset {
  id: string;
  name: string;
  description: string;
  market: string;
  location: {
    label: string;
    latitude: number;
    longitude: number;
  };
  ratedPowerMw: number;
  usableEnergyMwh: number;
  minSocFraction: number;
  maxSocFraction: number;
  startingSocFraction: number;
  roundTripEfficiency: number;
  reserveRequirementMw: number;
  maxRampMwPerInterval: number;
  thermal: BatteryThermalConfig;
  status: AssetStatus;
}

export interface MarketHour {
  hour: number;
  priceCadPerMwh: number;
  demandMw: number;
  reservePriceCadPerMwh: number;
  marginalEmissionsKgPerMwh: number;
}

export interface RenewableHour {
  hour: number;
  windMw: number;
  solarMw: number;
  ambientTemperatureC: number;
}

export interface ScenarioAdjustment {
  windMultiplier?: number;
  windHours?: number[];
  solarMultiplier?: number;
  solarHours?: number[];
  demandMultiplier?: number;
  demandHours?: number[];
  priceMultiplier?: number;
  priceHours?: number[];
  temperatureAddC?: number;
  temperatureHours?: number[];
  /** Fraction (0-1) shaved off rated power during deratingHours. */
  deratingPercent?: number;
  deratingHours?: number[];
}

export interface ScenarioDefinition {
  id: string;
  name: string;
  category: string;
  description: string;
  visible: ScenarioAdjustment;
  hiddenStress: ScenarioAdjustment | null;
  hiddenStressDescription: string | null;
}

export interface SimilarScenarioRecord {
  id: string;
  title: string;
  scenarioType: string;
  tags: string[];
  summary: string;
  outcome: string;
  dateLabel: string;
}

/** A single hour of resolved conditions used for planning, validation, and simulation. */
export interface ConditionHour {
  hour: number;
  timestamp: string;
  priceCadPerMwh: number;
  demandMw: number;
  reservePriceCadPerMwh: number;
  marginalEmissionsKgPerMwh: number;
  windMw: number;
  solarMw: number;
  ambientTemperatureC: number;
  /** Rated power after any scenario derating for this hour, before thermal derating. */
  deratedRatedPowerMw: number;
}

export interface ScenarioConditions {
  scenarioId: string;
  demoDate: string;
  intervalMinutes: number;
  /** What the planning assistants are shown. */
  visibleHours: ConditionHour[];
  /** What the simulator and stress tests evaluate against (visible + hidden stress). */
  actualHours: ConditionHour[];
  hiddenStressDescription: string | null;
}

export type DispatchAction = "charge" | "discharge" | "hold";

export interface DispatchInterval {
  timestamp: string;
  chargeMw: number;
  dischargeMw: number;
  reserveMw: number;
  rationale: string;
  confidence: number;
}

export interface DispatchPlan {
  schemaVersion: 1;
  assetId: string;
  scenarioId: string;
  horizonStart: string;
  intervalMinutes: number;
  strategy: string;
  modelId?: string;
  assumptions: string[];
  warnings: string[];
  intervals: DispatchInterval[];
}

export type ViolationSeverity = "error" | "warning";

export interface ConstraintViolation {
  code: string;
  severity: ViolationSeverity;
  hour: number;
  message: string;
}

export interface IntervalTrace {
  hour: number;
  timestamp: string;
  chargeMw: number;
  dischargeMw: number;
  reserveMw: number;
  socFractionStart: number;
  socFractionEnd: number;
  socMwhEnd: number;
  revenueCad: number;
  reserveRevenueCad: number;
  degradationCostCad: number;
  carbonAvoidedKg: number;
  netValueCad: number;
}

export interface SimulationMetrics {
  netValueCad: number;
  energyRevenueCad: number;
  reserveRevenueCad: number;
  degradationCostCad: number;
  totalChargeMwh: number;
  totalDischargeMwh: number;
  equivalentFullCycles: number;
  carbonAvoidedKg: number;
  renewableCapturedMwh: number;
  minSocFraction: number;
  maxSocFraction: number;
  finalSocFraction: number;
}

export interface SimulationResult {
  assetId: string;
  scenarioId: string;
  valid: boolean;
  violations: ConstraintViolation[];
  metrics: SimulationMetrics;
  trace: IntervalTrace[];
}

export interface ObjectiveWeights {
  netValue: number;
  renewableCapture: number;
  carbonAvoided: number;
  degradation: number;
}

export interface RankedCandidate {
  candidateId: string;
  rank: number;
  score: number;
  disqualified: boolean;
  disqualifyReason?: string;
  violationCount: number;
  breakdown: Record<keyof ObjectiveWeights, number>;
}
