import assetsData from "@/data/grid/assets.json";
import marketData from "@/data/grid/market-24h.json";
import renewableData from "@/data/grid/renewable-24h.json";
import scenariosData from "@/data/grid/scenarios.json";
import similarScenariosData from "@/data/grid/similar-scenarios.json";
import type {
  BatteryAsset,
  MarketHour,
  RenewableHour,
  ScenarioDefinition,
  SimilarScenarioRecord,
} from "@/lib/grid/types";

const assets = assetsData.assets as BatteryAsset[];
const marketHours = marketData.hours as MarketHour[];
const renewableHours = renewableData.hours as RenewableHour[];
const scenarios = scenariosData.scenarios as ScenarioDefinition[];
const similarScenarios = similarScenariosData.records as SimilarScenarioRecord[];

export const MARKET_DEMO_DATE = marketData.demoDate;
export const MARKET_INTERVAL_MINUTES = marketData.intervalMinutes;
export const MARKET_NAME = marketData.market;

export function listAssets(): BatteryAsset[] {
  return assets;
}

export function getAsset(assetId: string): BatteryAsset | undefined {
  return assets.find((asset) => asset.id === assetId);
}

export function requireAsset(assetId: string): BatteryAsset {
  const asset = getAsset(assetId);
  if (!asset) {
    throw new Error(`Unknown battery asset id: "${assetId}"`);
  }
  return asset;
}

export function getBaselineMarketHours(): MarketHour[] {
  return marketHours;
}

export function getBaselineRenewableHours(): RenewableHour[] {
  return renewableHours;
}

export function listScenarios(): ScenarioDefinition[] {
  return scenarios;
}

export function getScenario(scenarioId: string): ScenarioDefinition | undefined {
  return scenarios.find((scenario) => scenario.id === scenarioId);
}

export function requireScenario(scenarioId: string): ScenarioDefinition {
  const scenario = getScenario(scenarioId);
  if (!scenario) {
    throw new Error(`Unknown scenario id: "${scenarioId}"`);
  }
  return scenario;
}

export function listSimilarScenarios(): SimilarScenarioRecord[] {
  return similarScenarios;
}

export function findSimilarScenarios(query: {
  scenarioType?: string;
  tags?: string[];
  limit?: number;
}): SimilarScenarioRecord[] {
  const limit = query.limit ?? 3;
  const tagSet = new Set((query.tags ?? []).map((tag) => tag.toLowerCase()));

  const scored = similarScenarios.map((record) => {
    let score = 0;
    if (query.scenarioType && record.scenarioType === query.scenarioType) {
      score += 2;
    }
    for (const tag of record.tags) {
      if (tagSet.has(tag.toLowerCase())) {
        score += 1;
      }
    }
    return { record, score };
  });

  const matched = scored.filter((entry) => entry.score > 0);
  const pool = matched.length > 0 ? matched : scored;

  return pool
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.record);
}

export interface FixtureEnvelope<T> {
  dataMode: "fixture";
  source: string;
  generatedAt: string;
  scenarioId: string;
  data: T;
}

export function withFixtureEnvelope<T>(
  data: T,
  scenarioId: string,
  source: string,
): FixtureEnvelope<T> {
  return {
    dataMode: "fixture",
    source,
    generatedAt: new Date().toISOString(),
    scenarioId,
    data,
  };
}
