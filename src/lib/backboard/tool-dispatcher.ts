import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import type { BackboardAdapter, ChatToolCall } from "@/lib/backboard/client";
import { TOOL_NAMES, type ToolName } from "@/lib/backboard/tools";
import {
  citizenCohortSchema,
  citizenReactionContextSchema,
  citizenReactionSchema,
  interventionSchema as citizenInterventionSchema,
} from "@/lib/citizen-reaction/schemas";
import { getCitizenReactionProvider } from "@/lib/citizen-reaction/provider";
import type { CitizenReactionAggregate, CitizenReactionBatchResult } from "@/lib/citizen-reaction/schemas";
import { getTransitRepository, type TransitRepository } from "@/lib/transit/repository";
import {
  persistBackboardToolCall,
  persistCitizenReactions,
  persistPolicyIteration,
  persistSimulationRun,
  persistTrainingExamples,
} from "@/lib/mongodb/operational-store";
import { rankInterventions, type RankableIntervention } from "@/lib/transit/candidate-ranker";
import { simulateTransit } from "@/lib/transit/simulator";
import { stressTestIntervention, type StressTestOutcome } from "@/lib/transit/stress-tests";
import { transitInterventionSchema, type TransitIntervention, type TransitSimulationResult } from "@/lib/transit/schemas";
import { parseMapActions, type MapAction } from "@/lib/techto/map-actions";
import {
  actionToOverlay,
  findCollision,
  MAP_COLLISION_METERS,
  type AgentMapOverlay,
} from "@/lib/techto/map-overlays";
import { emptyTwinSnapshot, patchTwin, queryTwin, type TwinSnapshot } from "@/lib/planner/state";
import { diffTwin } from "@/lib/planner/diff";
import { parseScenarioPatch, parseScenarioPatches, type ScenarioPatch } from "@/lib/planner/scenario";
import { scoreRealPolicyAcceptance, policyTextForPatch } from "@/lib/citizen-reaction/policy-acceptance";
import { runAgentPython } from "@/lib/analysis/run-python";
import { matchCannedAsk } from "@/lib/planner/canned";
import { isTechTOAssistantKey, ASSISTANT_ROSTER } from "@/lib/backboard/assistants";
import { getToolDefinitions } from "@/lib/backboard/tools";
import {
  queryTorontoAreas,
  type TorontoAreaSortField,
} from "@/lib/toronto/area-catalog";

export class ToolDispatchError extends Error {}

/** Fixed seed used for every deterministic simulation the tool dispatcher runs, so repeated tool calls in one run are reproducible. */
export const TOOL_DISPATCH_SEED = 20260718;

/** What the dispatcher knows about one candidate schedule intervention as tool calls populate it during a run. */
export interface CandidateSimulationState {
  intervention?: TransitIntervention;
  visible?: TransitSimulationResult;
  stress?: StressTestOutcome;
  citizenReactions?: CitizenReactionBatchResult;
}

export interface PolicyIterationRecord {
  scenarioId: string;
  intervention: TransitIntervention;
  iterationLabel: string;
  notes?: string;
  recordedAt: string;
}

/**
 * Per-run, in-memory state shared across every tool call in one orchestration
 * run (never persisted; a fresh context is created per run). This is what
 * lets compare_interventions and later stages reference simulations,
 * stress tests, and citizen reactions performed earlier in the same run
 * without the model having to echo huge payloads back.
 */
export interface MapContextState {
  center: [number, number];
  zoom: number;
  selectedStationId: string | null;
  selectedNeighbourhoodId: string | null;
  highlightedNeighbourhoodIds: string[];
  visibleLayers: string[];
}

export interface RunContext {
  scenarioId: string;
  /** Planning run id when inside orchestration; used for Mongo tool-call provenance. */
  runId?: string;
  adapter: BackboardAdapter;
  simulationsByCandidateId: Map<string, CandidateSimulationState>;
  iterations: PolicyIterationRecord[];
  mapContext: MapContextState;
  stationCandidates: Array<{
    candidateId: string;
    neighbourhoodId: string;
    label: string;
    coordinates: [number, number];
    rankHint: number;
  }>;
  composedMapActions: unknown[];
  /** Agent map drawings for this run (and seeded from UI). */
  agentOverlays: AgentMapOverlay[];
  /** In-memory city twin for open asks (query/patch/run). */
  twin: TwinSnapshot;
  twinBaseline: TwinSnapshot;
  twinSnapshots: Map<string, TwinSnapshot>;
  proposedCityPatches: ScenarioPatch[];
  /** Roles invoked via invoke_assistant during this run. */
  invokedAssistants: string[];
  /** Prevent nested invoke recursion. */
  invokeDepth: number;
  /** Bubble nested specialist tool calls up to the city orchestrator UI. */
  onNestedToolStart?: (call: ChatToolCall, role: string) => void;
  onNestedToolEnd?: (outcome: ToolCallOutcome, role: string) => void;
  /** Bubble each real Monte-Carlo-sampled resident's score.population/run_twin_analysis result up to the map so its dot can be coloured live. */
  onPersonaScored?: (result: { personaId: string; code: string; acceptance: number; opinionText: string }) => void;
}

const DEFAULT_MAP_CONTEXT: MapContextState = {
  center: [-79.3832, 43.6532],
  zoom: 12.5,
  selectedStationId: "union",
  selectedNeighbourhoodId: null,
  highlightedNeighbourhoodIds: [],
  visibleLayers: ["transit", "neighbourhoods"],
};

export function createRunContext(
  scenarioId: string,
  adapter: BackboardAdapter,
  mapContext?: Partial<MapContextState>,
  runId?: string,
  extras?: {
    agentOverlays?: AgentMapOverlay[];
    onNestedToolStart?: (call: ChatToolCall, role: string) => void;
    onNestedToolEnd?: (outcome: ToolCallOutcome, role: string) => void;
    onPersonaScored?: (result: { personaId: string; code: string; acceptance: number; opinionText: string }) => void;
  },
): RunContext {
  return {
    scenarioId,
    runId,
    adapter,
    simulationsByCandidateId: new Map(),
    iterations: [],
    mapContext: { ...DEFAULT_MAP_CONTEXT, ...mapContext },
    stationCandidates: [],
    composedMapActions: [],
    agentOverlays: extras?.agentOverlays ? [...extras.agentOverlays] : [],
    twin: emptyTwinSnapshot(),
    twinBaseline: emptyTwinSnapshot(),
    twinSnapshots: new Map(),
    proposedCityPatches: [],
    invokedAssistants: [],
    invokeDepth: 0,
    onNestedToolStart: extras?.onNestedToolStart,
    onNestedToolEnd: extras?.onNestedToolEnd,
    onPersonaScored: extras?.onPersonaScored,
  };
}

export interface ToolCallOutcome {
  toolCallId: string;
  toolName: string;
  ok: boolean;
  output: unknown;
}

function candidateState(context: RunContext, candidateId: string): CandidateSimulationState {
  const existing = context.simulationsByCandidateId.get(candidateId);
  if (existing) return existing;
  const created: CandidateSimulationState = {};
  context.simulationsByCandidateId.set(candidateId, created);
  return created;
}

function requireRegisteredIntervention(context: RunContext, interventionId: string): TransitIntervention {
  const state = context.simulationsByCandidateId.get(interventionId);
  if (!state?.intervention) {
    throw new ToolDispatchError(
      `Intervention "${interventionId}" is not registered in this run. Call propose_schedule_variants or ` +
        `run_transit_simulation with the full intervention object first.`,
    );
  }
  return state.intervention;
}

function ensureSimulated(
  context: RunContext,
  scenarioId: string,
  intervention: TransitIntervention,
  repo: TransitRepository,
): TransitSimulationResult {
  const scenario = repo.getScenario(scenarioId);
  if (!scenario) {
    throw new ToolDispatchError(`Unknown transit scenario id: "${scenarioId}".`);
  }
  const state = candidateState(context, intervention.id);
  state.intervention = intervention;
  if (state.visible) return state.visible;

  const result = simulateTransit({
    schemaVersion: 1,
    scenario,
    intervention,
    stressOverlay: null,
    seed: TOOL_DISPATCH_SEED,
    cohorts: repo.listCohorts(),
  });
  state.visible = result;
  return result;
}

// ---------------------------------------------------------------------------
// Argument schemas (mirror the parameter shapes declared in tools.ts)
// ---------------------------------------------------------------------------

const scenarioIdArgsSchema = z.object({ scenarioId: z.string().min(1) }).strict();

const routeScenarioArgsSchema = z
  .object({ routeId: z.string().min(1), scenarioId: z.string().min(1) })
  .strict();

const scenarioInterventionIdArgsSchema = z
  .object({ scenarioId: z.string().min(1), interventionId: z.string().min(1).optional() })
  .strict();

const routeIdArgsSchema = z.object({ routeId: z.string().min(1) }).strict();

const incidentsArgsSchema = z.object({ routeId: z.string().min(1).optional() }).strict();

const interventionEvalArgsSchema = z
  .object({ scenarioId: z.string().min(1), intervention: transitInterventionSchema })
  .strict();

const stressTestArgsSchema = z
  .object({
    scenarioId: z.string().min(1),
    intervention: transitInterventionSchema,
    stressOverlayId: z.string().min(1).optional(),
  })
  .strict();

const compareArgsSchema = z
  .object({
    scenarioId: z.string().min(1),
    interventionIds: z.array(z.string().min(1)).min(1).max(10),
  })
  .strict();

const saveIterationArgsSchema = z
  .object({
    scenarioId: z.string().min(1),
    intervention: transitInterventionSchema,
    iterationLabel: z.string().min(1),
    notes: z.string().optional(),
  })
  .strict();

const retrieveDocsArgsSchema = z
  .object({ query: z.string().min(1), limit: z.number().int().positive().max(20).optional() })
  .strict();

const writeMemoryArgsSchema = z
  .object({
    memory: z.string().min(1),
    scenarioId: z.string().min(1).optional(),
    tags: z.array(z.string().min(1)).optional(),
  })
  .strict();

const createTrainingArgsSchema = z
  .object({
    scenarioId: z.string().min(1),
    interventionId: z.string().min(1),
    label: z.string().min(1),
  })
  .strict();

const findSimilarArgsSchema = z
  .object({
    interventionType: z.string().min(1).optional(),
    tags: z.array(z.string().min(1)).max(10).optional(),
    limit: z.number().int().positive().max(20).optional(),
  })
  .strict();

const proposeVariantsArgsSchema = z
  .object({
    scenarioId: z.string().min(1),
    candidates: z.array(transitInterventionSchema).min(1).max(5),
  })
  .strict();

const callCitizenModelArgsSchema = z
  .object({
    scenarioId: z.string().min(1),
    intervention: citizenInterventionSchema,
    cohorts: z.array(citizenCohortSchema).min(1).max(500),
    context: citizenReactionContextSchema,
  })
  .strict();

const aggregateReactionsArgsSchema = z
  .object({
    scenarioId: z.string().min(1),
    reactions: z.array(citizenReactionSchema).min(1),
  })
  .strict();

// ---------------------------------------------------------------------------
// get_* handlers
// ---------------------------------------------------------------------------

function handleGetNetworkSnapshot(repo: TransitRepository) {
  return repo.getNetworkSnapshot();
}

function handleGetRouteSchedule(args: unknown, repo: TransitRepository) {
  const { routeId, scenarioId } = routeScenarioArgsSchema.parse(args);
  return repo.getRouteSchedule(routeId, scenarioId);
}

function handleGetDepartureLoads(args: unknown, repo: TransitRepository, context: RunContext) {
  const { scenarioId, interventionId } = scenarioInterventionIdArgsSchema.parse(args);
  if (!interventionId) {
    return {
      scenarioId,
      interventionId: null,
      departureLoads: repo.getDepartureLoads(scenarioId),
      storageLayer: repo.getStorageLayer(),
    };
  }
  const intervention = requireRegisteredIntervention(context, interventionId);
  const result = ensureSimulated(context, scenarioId, intervention, repo);
  return {
    scenarioId,
    interventionId,
    departureLoads: result.departureLoads,
    storageLayer: repo.getStorageLayer(),
  };
}

function handleGetPassengerArrivals(args: unknown, repo: TransitRepository) {
  const { scenarioId } = scenarioIdArgsSchema.parse(args);
  return { scenarioId, arrivals: repo.getPassengerArrivals(scenarioId) };
}

function handleGetOdFlows(args: unknown, repo: TransitRepository) {
  scenarioIdArgsSchema.parse(args);
  return { flows: repo.getOriginDestinationFlows() };
}

function handleGetStopCrowding(args: unknown, repo: TransitRepository, context: RunContext) {
  const { scenarioId, interventionId } = scenarioInterventionIdArgsSchema.parse(args);
  const scenario = repo.getScenario(scenarioId);
  if (!scenario) {
    throw new ToolDispatchError(`Unknown transit scenario id: "${scenarioId}".`);
  }
  if (!interventionId) {
    return {
      ...repo.getStopCrowding(`${scenario.stationId}-platform`, scenarioId),
      storageLayer: repo.getStorageLayer(),
    };
  }
  const intervention = requireRegisteredIntervention(context, interventionId);
  const result = ensureSimulated(context, scenarioId, intervention, repo);
  const peakQueueLength = result.queueTrace.reduce((max, point) => Math.max(max, point.queueLength), 0);
  const peakLoad = result.departureLoads.reduce((max, load) => Math.max(max, load.loadFactor), 0);
  return {
    stopId: `${scenario.stationId}-platform`,
    stationId: scenario.stationId,
    routeId: scenario.routeId,
    peakQueueLength,
    loadFactorAtPeak: peakLoad,
    dataMode: "synthetic-fixture" as const,
    storageLayer: repo.getStorageLayer(),
  };
}

function handleGetTransferDemand(args: unknown, repo: TransitRepository) {
  const { scenarioId } = scenarioIdArgsSchema.parse(args);
  const scenario = repo.getScenario(scenarioId);
  if (!scenario) {
    throw new ToolDispatchError(`Unknown transit scenario id: "${scenarioId}".`);
  }
  return { ...repo.getTransferDemand(scenario.routeId), storageLayer: repo.getStorageLayer() };
}

function handleGetDelayHistory(args: unknown, repo: TransitRepository) {
  const { routeId } = routeIdArgsSchema.parse(args);
  return { routeId, history: repo.getDelayHistory(routeId) };
}

function handleGetVehicleCapacity(args: unknown, repo: TransitRepository) {
  const { routeId } = routeIdArgsSchema.parse(args);
  return { routeId, vehicleCapacity: repo.getVehicleCapacity(routeId) };
}

function handleGetFleetAvailability(args: unknown, repo: TransitRepository) {
  const { routeId } = routeIdArgsSchema.parse(args);
  return repo.getFleetAvailability(routeId);
}

function handleGetDemographics(args: unknown, repo: TransitRepository) {
  scenarioIdArgsSchema.parse(args);
  return { demographics: repo.getNeighbourhoodDemographics() };
}

function handleGetAccessibility(args: unknown, repo: TransitRepository) {
  const { scenarioId } = scenarioIdArgsSchema.parse(args);
  const scenario = repo.getScenario(scenarioId);
  if (!scenario) {
    throw new ToolDispatchError(`Unknown transit scenario id: "${scenarioId}".`);
  }
  return {
    ...repo.getAccessibilityConstraints(scenario.stationId),
    storageLayer: repo.getStorageLayer(),
  };
}

function handleGetEventContext(repo: TransitRepository) {
  return repo.getEventContext();
}

function handleGetWeatherContext(repo: TransitRepository) {
  return repo.getWeatherContext();
}

function handleGetIncidents(args: unknown, repo: TransitRepository) {
  const { routeId } = incidentsArgsSchema.parse(args);
  const incidents = repo.getServiceIncidents();
  return { incidents: routeId ? incidents.filter((incident) => incident.routeId === routeId) : incidents };
}

function handleFindSimilar(args: unknown, repo: TransitRepository) {
  const query = findSimilarArgsSchema.parse(args);
  return { records: repo.findSimilarInterventions(query) };
}

// ---------------------------------------------------------------------------
// Intervention lifecycle: propose, simulate, calculate metrics, stress-test, compare
// ---------------------------------------------------------------------------

function handleProposeVariants(args: unknown, context: RunContext) {
  const { scenarioId, candidates } = proposeVariantsArgsSchema.parse(args);
  for (const candidate of candidates) {
    const state = candidateState(context, candidate.id);
    state.intervention = candidate;
  }
  return { scenarioId, registered: candidates.map((candidate) => candidate.id) };
}

async function handleRunSimulation(args: unknown, context: RunContext, repo: TransitRepository) {
  const { scenarioId, intervention } = interventionEvalArgsSchema.parse(args);
  const scenario = repo.getScenario(scenarioId);
  if (!scenario) {
    throw new ToolDispatchError(`Unknown transit scenario id: "${scenarioId}".`);
  }
  const state = candidateState(context, intervention.id);
  state.intervention = intervention;
  const result = simulateTransit({
    schemaVersion: 1,
    scenario,
    intervention,
    stressOverlay: null,
    seed: TOOL_DISPATCH_SEED,
    cohorts: repo.listCohorts(),
  });
  state.visible = result;
  const persisted = await persistSimulationRun({ scenarioId, intervention, result });
  return {
    ...result,
    storageLayer: repo.getStorageLayer(),
    mongo: persisted,
  };
}

function handleCalculateWait(args: unknown, context: RunContext, repo: TransitRepository) {
  const { scenarioId, intervention } = interventionEvalArgsSchema.parse(args);
  const result = ensureSimulated(context, scenarioId, intervention, repo);
  return {
    interventionId: intervention.id,
    valid: result.valid,
    meanWaitMinutes: result.metrics.meanWaitMinutes,
    p90WaitMinutes: result.metrics.p90WaitMinutes,
    storageLayer: repo.getStorageLayer(),
  };
}

function handleCalculateLoad(args: unknown, context: RunContext, repo: TransitRepository) {
  const { scenarioId, intervention } = interventionEvalArgsSchema.parse(args);
  const result = ensureSimulated(context, scenarioId, intervention, repo);
  return {
    interventionId: intervention.id,
    valid: result.valid,
    loadImbalance: result.metrics.loadImbalance,
    deniedBoardings: result.metrics.deniedBoardings,
    storageLayer: repo.getStorageLayer(),
  };
}

function handleCalculateReliability(args: unknown, context: RunContext, repo: TransitRepository) {
  const { scenarioId, intervention } = interventionEvalArgsSchema.parse(args);
  const scenario = repo.getScenario(scenarioId);
  const result = ensureSimulated(context, scenarioId, intervention, repo);
  return {
    interventionId: intervention.id,
    valid: result.valid,
    missedTransfers: result.metrics.missedTransfers,
    recentDelayHistory: scenario ? repo.getDelayHistory(scenario.routeId) : [],
    storageLayer: repo.getStorageLayer(),
  };
}

function handleCalculateEquity(args: unknown, context: RunContext, repo: TransitRepository) {
  const { scenarioId, intervention } = interventionEvalArgsSchema.parse(args);
  const result = ensureSimulated(context, scenarioId, intervention, repo);
  return {
    interventionId: intervention.id,
    valid: result.valid,
    equityGap: result.metrics.equityGap,
    storageLayer: repo.getStorageLayer(),
  };
}

function handleCalculateAccessibility(args: unknown, context: RunContext, repo: TransitRepository) {
  const { scenarioId, intervention } = interventionEvalArgsSchema.parse(args);
  const result = ensureSimulated(context, scenarioId, intervention, repo);
  return {
    interventionId: intervention.id,
    valid: result.valid,
    accessibilityFailures: result.metrics.accessibilityFailures,
    violations: result.violations.filter((violation) => violation.code.startsWith("accessibility")),
    storageLayer: repo.getStorageLayer(),
  };
}

function handleCalculateCost(args: unknown, context: RunContext, repo: TransitRepository) {
  const { scenarioId, intervention } = interventionEvalArgsSchema.parse(args);
  const result = ensureSimulated(context, scenarioId, intervention, repo);
  return {
    interventionId: intervention.id,
    valid: result.valid,
    operatingCostScore: result.metrics.operatingCostScore,
    storageLayer: repo.getStorageLayer(),
  };
}

function handleCalculateCarbon(args: unknown, context: RunContext, repo: TransitRepository) {
  const { scenarioId, intervention } = interventionEvalArgsSchema.parse(args);
  const result = ensureSimulated(context, scenarioId, intervention, repo);
  return {
    interventionId: intervention.id,
    valid: result.valid,
    estimatedCarTrips: result.metrics.estimatedCarTrips,
    estimatedCarbonKg: result.metrics.estimatedCarbonKg,
    storageLayer: repo.getStorageLayer(),
  };
}

function handleStressTest(args: unknown, context: RunContext, repo: TransitRepository) {
  const { scenarioId, intervention, stressOverlayId } = stressTestArgsSchema.parse(args);
  const scenario = repo.getScenario(scenarioId);
  if (!scenario) {
    throw new ToolDispatchError(`Unknown transit scenario id: "${scenarioId}".`);
  }
  const overlay = stressOverlayId ? repo.getStressOverlay(stressOverlayId) : repo.listStressOverlays()[0];
  if (!overlay) {
    throw new ToolDispatchError(
      stressOverlayId
        ? `Unknown transit stress overlay id: "${stressOverlayId}".`
        : "No stress overlay is registered for this scenario.",
    );
  }
  const state = candidateState(context, intervention.id);
  state.intervention = intervention;
  const outcome = stressTestIntervention(scenario, intervention, overlay, TOOL_DISPATCH_SEED, repo.listCohorts());
  state.visible = state.visible ?? outcome.baseline;
  state.stress = outcome;
  return { ...outcome, storageLayer: repo.getStorageLayer() };
}

function handleComparePolicies(args: unknown, context: RunContext) {
  const { interventionIds } = compareArgsSchema.parse(args);
  const rankable: RankableIntervention[] = interventionIds.map((interventionId) => {
    const state = context.simulationsByCandidateId.get(interventionId);
    if (!state?.intervention || !state.visible) {
      throw new ToolDispatchError(
        `Intervention "${interventionId}" has not been simulated yet. Call run_transit_simulation for it first.`,
      );
    }
    return { intervention: state.intervention, result: state.visible };
  });
  return { ranked: rankInterventions(rankable) };
}

async function handleSaveIteration(args: unknown, context: RunContext, repo: TransitRepository) {
  const { scenarioId, intervention, iterationLabel, notes } = saveIterationArgsSchema.parse(args);
  const record: PolicyIterationRecord = {
    scenarioId,
    intervention,
    iterationLabel,
    notes,
    recordedAt: new Date().toISOString(),
  };
  context.iterations.push(record);
  const state = candidateState(context, intervention.id);
  state.intervention = intervention;
  const persisted = await persistPolicyIteration({ scenarioId, intervention, iterationLabel, notes });
  return {
    saved: true,
    iterationCount: context.iterations.length,
    record,
    storageLayer: repo.getStorageLayer(),
    mongo: persisted,
  };
}

// ---------------------------------------------------------------------------
// Citizen reaction model
// ---------------------------------------------------------------------------

async function handleCallCitizenModel(args: unknown, context: RunContext, repo: TransitRepository) {
  const parsed = callCitizenModelArgsSchema.parse(args);
  const provider = getCitizenReactionProvider();
  const result = await provider.predictBatch(parsed);
  const interventionId = parsed.intervention.id ?? parsed.intervention.title;
  const state = candidateState(context, interventionId);
  state.citizenReactions = result;
  const persisted = await persistCitizenReactions({
    scenarioId: context.scenarioId,
    interventionId,
    batch: result,
  });
  return { ...result, storageLayer: repo.getStorageLayer(), mongo: persisted };
}

function computeReactionAggregate(
  reactions: z.output<typeof citizenReactionSchema>[],
  repo: TransitRepository,
): CitizenReactionAggregate {
  const weightByCohortId = new Map(repo.listCohorts().map((cohort) => [cohort.id, cohort.weight]));
  const acceptances = reactions.map((reaction) => reaction.acceptance);
  const n = acceptances.length;
  const meanAcceptance = acceptances.reduce((sum, value) => sum + value, 0) / n;

  const sorted = [...acceptances].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const medianAcceptance = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];

  const variance = acceptances.reduce((sum, value) => sum + (value - meanAcceptance) ** 2, 0) / n;
  const stdDevAcceptance = Math.sqrt(variance);

  let weightedSum = 0;
  let totalWeight = 0;
  for (const reaction of reactions) {
    const weight = weightByCohortId.get(reaction.cohortId) ?? 1;
    weightedSum += reaction.acceptance * weight;
    totalWeight += weight;
  }
  const populationWeightedAcceptance = totalWeight > 0 ? weightedSum / totalWeight : meanAcceptance;

  const meanModeShiftProb = reactions.reduce((sum, reaction) => sum + reaction.modeShiftProb, 0) / n;
  const meanPreferredDepartureShiftMinutes =
    reactions.reduce((sum, reaction) => sum + reaction.preferredDepartureShiftMinutes, 0) / n;

  let acceptCount = 0;
  let rejectCount = 0;
  let neutralCount = 0;
  for (const reaction of reactions) {
    if (reaction.acceptance >= 0.6) acceptCount += 1;
    else if (reaction.acceptance <= 0.4) rejectCount += 1;
    else neutralCount += 1;
  }

  return {
    cohortCount: n,
    meanAcceptance,
    medianAcceptance,
    stdDevAcceptance,
    populationWeightedAcceptance,
    meanModeShiftProb,
    meanPreferredDepartureShiftMinutes,
    acceptCount,
    neutralCount,
    rejectCount,
  };
}

function handleAggregateReactions(args: unknown, repo: TransitRepository) {
  const { scenarioId, reactions } = aggregateReactionsArgsSchema.parse(args);
  return {
    scenarioId,
    aggregate: computeReactionAggregate(reactions, repo),
    storageLayer: repo.getStorageLayer(),
  };
}

// ---------------------------------------------------------------------------
// Knowledge document retrieval (naive local search over docs/backboard/knowledge)
// ---------------------------------------------------------------------------

interface KnowledgeParagraph {
  filename: string;
  text: string;
}

let knowledgeCache: Promise<KnowledgeParagraph[]> | null = null;

async function loadKnowledgeParagraphs(): Promise<KnowledgeParagraph[]> {
  if (!knowledgeCache) {
    knowledgeCache = (async () => {
      const dir = path.join(process.cwd(), "docs", "backboard", "knowledge");
      let filenames: string[] = [];
      try {
        filenames = (await readdir(dir)).filter((name) => name.endsWith(".md"));
      } catch {
        return [];
      }
      const paragraphs: KnowledgeParagraph[] = [];
      for (const filename of filenames) {
        const content = await readFile(path.join(dir, filename), "utf-8").catch(() => "");
        for (const block of content.split(/\n{2,}/)) {
          const text = block.trim();
          if (text.length > 0) paragraphs.push({ filename, text });
        }
      }
      return paragraphs;
    })();
  }
  return knowledgeCache;
}

function scoreParagraph(paragraph: string, queryWords: string[]): number {
  const lower = paragraph.toLowerCase();
  return queryWords.reduce((score, word) => (lower.includes(word) ? score + 1 : score), 0);
}

async function handleRetrieveDocuments(args: unknown) {
  const { query, limit } = retrieveDocsArgsSchema.parse(args);
  const paragraphs = await loadKnowledgeParagraphs();
  const queryWords = query.toLowerCase().split(/\W+/).filter((word) => word.length > 2);

  const scored = paragraphs
    .map((paragraph) => ({ paragraph, score: scoreParagraph(paragraph.text, queryWords) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit ?? 5);

  return {
    query,
    excerpts: scored.map((entry) => ({ document: entry.paragraph.filename, excerpt: entry.paragraph.text })),
  };
}

// ---------------------------------------------------------------------------
// Memory and training curation
// ---------------------------------------------------------------------------

async function handleWriteMemory(args: unknown, context: RunContext, assistantId: string) {
  const { memory, scenarioId, tags } = writeMemoryArgsSchema.parse(args);
  const record = await context.adapter.addMemory(assistantId, memory, { scenarioId, tags });
  return { saved: true, memoryId: record.id };
}

async function handleCreateTraining(args: unknown, context: RunContext, repo: TransitRepository) {
  const { scenarioId, interventionId, label } = createTrainingArgsSchema.parse(args);
  const state = context.simulationsByCandidateId.get(interventionId);
  if (!state?.intervention || !state.visible) {
    throw new ToolDispatchError(
      `Intervention "${interventionId}" has not been simulated yet; nothing reviewed to package into training rows.`,
    );
  }
  const rows = [
    {
      input: { scenarioId, intervention: state.intervention },
      output: { metrics: state.visible.metrics, valid: state.visible.valid },
      metadata: {
        citizenReactions: state.citizenReactions ?? null,
        stress: state.stress ? { invalidated: state.stress.invalidated } : null,
      },
    },
  ];
  const persisted = await persistTrainingExamples({
    scenarioId,
    interventionId,
    label,
    rows,
  });
  return {
    label,
    rowCount: 1,
    rows,
    storageLayer: repo.getStorageLayer(),
    mongo: persisted,
  };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

async function executeTool(
  name: string,
  args: unknown,
  context: RunContext,
  assistantId: string,
): Promise<unknown> {
  const repo = await getTransitRepository();

  switch (name as ToolName) {
    case TOOL_NAMES.GET_CURRENT_MAP_CONTEXT:
      return {
        dataMode: "synthetic-fixture",
        provenance: "run-context-map",
        storageLayer: repo.getStorageLayer(),
        ...context.mapContext,
        scenarioId: context.scenarioId,
        agentOverlays: context.agentOverlays,
        twinPoiCount: context.twin.pois.length,
        twinCorridorCount: context.twin.corridors.length,
      };
    case TOOL_NAMES.QUERY_CITY_LAYER: {
      const parsed = z
        .object({
          layer: z.literal("neighbourhoods"),
          selector: z
            .object({
              name: z.string().optional(),
              minPopulation: z.number().nonnegative().optional(),
              maxMedianIncome: z.number().nonnegative().optional(),
              minRapidTransitGapKm: z.number().nonnegative().optional(),
            })
            .strict()
            .optional(),
          sortBy: z
            .enum([
              "name",
              "population",
              "medianIncome",
              "populationDensity",
              "rapidTransitGapKm",
              "surfaceTransitDistanceKm",
              "fallbackScore",
            ])
            .optional(),
          direction: z.enum(["asc", "desc"]).optional(),
          // keep this tool tiny: big screens belong in run_python
          limit: z.number().int().positive().max(5).optional(),
          detail: z.enum(["summary", "full"]).optional(),
        })
        .strict()
        .parse(args);
      const limit = Math.min(parsed.limit ?? 3, 5);
      const areas = queryTorontoAreas({
        ...parsed.selector,
        sortBy: parsed.sortBy as TorontoAreaSortField | undefined,
        direction: parsed.direction,
        limit,
      });
      const detail = parsed.detail ?? "summary";
      const rows =
        detail === "full"
          ? areas
          : areas.map((a) => ({
              code: a.code,
              name: a.name,
              center: a.center,
              population: a.population,
              medianIncome: a.medianIncome,
              rapidTransitGapKm: a.rapidTransitGapKm,
              surfaceTransitDistanceKm: a.surfaceTransitDistanceKm,
              fallbackScore: a.fallbackScore,
            }));
      return {
        layer: parsed.layer,
        dataMode: "official-open-data",
        detail,
        count: rows.length,
        areas: rows,
        note: "Slim neighbourhood screen only. For larger rankings/filters use run_python on DATA_DIR/census_profile.csv. Not a ridership forecast.",
      };
    }
    case TOOL_NAMES.SEARCH_NEIGHBOURHOODS: {
      const parsed = z
        .object({
          query: z.string().optional(),
          tags: z.array(z.string()).optional(),
          limit: z.number().int().positive().max(10).optional(),
        })
        .strict()
        .parse(args ?? {});
      return {
        dataMode: "synthetic-fixture",
        storageLayer: repo.getStorageLayer(),
        neighbourhoods: repo.searchNeighbourhoods(parsed.query, parsed.tags, parsed.limit ?? 5),
      };
    }
    case TOOL_NAMES.GET_NETWORK_SNAPSHOT:
      return { ...handleGetNetworkSnapshot(repo), storageLayer: repo.getStorageLayer() };
    case TOOL_NAMES.GET_ROUTE_SCHEDULE: {
      const schedule = handleGetRouteSchedule(args, repo);
      return Object.assign(schedule, { storageLayer: repo.getStorageLayer() });
    }
    case TOOL_NAMES.GET_DEPARTURE_LOADS:
      return handleGetDepartureLoads(args, repo, context);
    case TOOL_NAMES.GET_PASSENGER_ARRIVALS:
      return { ...handleGetPassengerArrivals(args, repo), storageLayer: repo.getStorageLayer() };
    case TOOL_NAMES.GET_OD_FLOWS:
      return { ...handleGetOdFlows(args, repo), storageLayer: repo.getStorageLayer() };
    case TOOL_NAMES.GET_STOP_CROWDING:
      return handleGetStopCrowding(args, repo, context);
    case TOOL_NAMES.GET_TRANSFER_DEMAND:
      return handleGetTransferDemand(args, repo);
    case TOOL_NAMES.GET_DELAY_HISTORY:
      return { ...handleGetDelayHistory(args, repo), storageLayer: repo.getStorageLayer() };
    case TOOL_NAMES.GET_VEHICLE_CAPACITY:
      return { ...handleGetVehicleCapacity(args, repo), storageLayer: repo.getStorageLayer() };
    case TOOL_NAMES.GET_FLEET_AVAILABILITY:
      return { ...handleGetFleetAvailability(args, repo), storageLayer: repo.getStorageLayer() };
    case TOOL_NAMES.GET_DEMOGRAPHICS:
      return { ...handleGetDemographics(args, repo), storageLayer: repo.getStorageLayer() };
    case TOOL_NAMES.GET_TRANSIT_ACCESSIBILITY: {
      const parsed = z
        .object({ neighbourhoodId: z.string().optional(), stationId: z.string().optional() })
        .strict()
        .parse(args ?? {});
      const neighbourhood = parsed.neighbourhoodId
        ? repo.requireNeighbourhood(parsed.neighbourhoodId)
        : repo.listNeighbourhoods()[0];
      return {
        dataMode: "synthetic-fixture",
        storageLayer: repo.getStorageLayer(),
        neighbourhoodId: neighbourhood.id,
        stationId: parsed.stationId ?? context.mapContext.selectedStationId,
        walkShedMinutes: 10,
        elevatorCoverage: neighbourhood.underservedAfter22 ? "partial" : "good",
        notes: neighbourhood.landUse,
      };
    }
    case TOOL_NAMES.GET_POPULATION_EMPLOYMENT_GROWTH: {
      const { neighbourhoodId } = z.object({ neighbourhoodId: z.string().min(1) }).strict().parse(args);
      const n = repo.requireNeighbourhood(neighbourhoodId);
      return {
        dataMode: "synthetic-fixture",
        storageLayer: repo.getStorageLayer(),
        neighbourhoodId: n.id,
        ...n.growthProxy,
      };
    }
    case TOOL_NAMES.GET_LAND_USE_CONTEXT: {
      const { neighbourhoodId } = z.object({ neighbourhoodId: z.string().min(1) }).strict().parse(args);
      const n = repo.requireNeighbourhood(neighbourhoodId);
      return {
        dataMode: "synthetic-fixture",
        storageLayer: repo.getStorageLayer(),
        neighbourhoodId: n.id,
        landUse: n.landUse,
        tags: n.tags,
      };
    }
    case TOOL_NAMES.GET_ACCESSIBILITY:
      return handleGetAccessibility(args, repo);
    case TOOL_NAMES.GET_EVENT_CONTEXT:
      return { ...handleGetEventContext(repo), storageLayer: repo.getStorageLayer() };
    case TOOL_NAMES.GET_WEATHER_CONTEXT:
      return { ...handleGetWeatherContext(repo), storageLayer: repo.getStorageLayer() };
    case TOOL_NAMES.GET_INCIDENTS:
      return { ...handleGetIncidents(args, repo), storageLayer: repo.getStorageLayer() };
    case TOOL_NAMES.FIND_SIMILAR:
      return { ...handleFindSimilar(args, repo), storageLayer: repo.getStorageLayer() };
    case TOOL_NAMES.GENERATE_STATION_CANDIDATES: {
      const parsed = z
        .object({ query: z.string().min(1), limit: z.number().int().positive().max(8).optional() })
        .strict()
        .parse(args);
      const neighbourhoods = repo.searchNeighbourhoods(parsed.query, undefined, parsed.limit ?? 5);
      const candidates = neighbourhoods.map((n, index) => ({
        candidateId: `station-${n.id}`,
        neighbourhoodId: n.id,
        label: `${n.name} station option`,
        coordinates: n.center,
        rankHint: index + 1,
        tags: n.tags,
        underservedAfter22: n.underservedAfter22,
      }));
      context.stationCandidates = candidates.map((c) => ({
        candidateId: c.candidateId,
        neighbourhoodId: c.neighbourhoodId,
        label: c.label,
        coordinates: c.coordinates,
        rankHint: c.rankHint,
      }));
      return { dataMode: "synthetic-fixture", storageLayer: repo.getStorageLayer(), candidates };
    }
    case TOOL_NAMES.PROPOSE_VARIANTS:
      return handleProposeVariants(args, context);
    case TOOL_NAMES.CALL_CITIZEN_MODEL:
      return handleCallCitizenModel(args, context, repo);
    case TOOL_NAMES.AGGREGATE_REACTIONS:
      return handleAggregateReactions(args, repo);
    case TOOL_NAMES.RUN_SIMULATION:
      return handleRunSimulation(args, context, repo);
    case TOOL_NAMES.SIMULATE_STATION_CANDIDATE: {
      const parsed = z
        .object({
          candidateId: z.string().min(1),
          scenarioId: z.string().optional(),
          seed: z.number().optional(),
        })
        .strict()
        .parse(args);
      const candidate =
        context.stationCandidates.find((c) => c.candidateId === parsed.candidateId) ??
        (() => {
          const neighbourhoods = repo.listNeighbourhoods();
          const n = neighbourhoods[0];
          return {
            candidateId: parsed.candidateId,
            neighbourhoodId: n.id,
            label: n.name,
            coordinates: n.center,
            rankHint: 1,
          };
        })();
      const seed = parsed.seed ?? TOOL_DISPATCH_SEED;
      const demandIndex = repo.requireNeighbourhood(candidate.neighbourhoodId).growthProxy.populationIndex;
      return {
        dataMode: "synthetic-fixture",
        storageLayer: repo.getStorageLayer(),
        candidateId: candidate.candidateId,
        seed,
        metrics: {
          meanWaitMinutes: Number((4.2 / demandIndex).toFixed(2)),
          accessScore: Number((0.55 + demandIndex * 0.1).toFixed(2)),
          equityGap: candidate.neighbourhoodId === "parkdale" || candidate.neighbourhoodId === "regent-park" ? 0.12 : 0.22,
          estimatedNewRiders: Math.round(800 * demandIndex),
        },
        provenance: "fixture-station-proxy-simulator",
      };
    }
    case TOOL_NAMES.CALCULATE_WAIT:
      return handleCalculateWait(args, context, repo);
    case TOOL_NAMES.CALCULATE_LOAD:
      return handleCalculateLoad(args, context, repo);
    case TOOL_NAMES.CALCULATE_RELIABILITY:
      return handleCalculateReliability(args, context, repo);
    case TOOL_NAMES.CALCULATE_EQUITY:
      return handleCalculateEquity(args, context, repo);
    case TOOL_NAMES.CALCULATE_ACCESSIBILITY:
      return handleCalculateAccessibility(args, context, repo);
    case TOOL_NAMES.CALCULATE_COST:
      return handleCalculateCost(args, context, repo);
    case TOOL_NAMES.CALCULATE_CARBON:
      return handleCalculateCarbon(args, context, repo);
    case TOOL_NAMES.STRESS_TEST:
      return handleStressTest(args, context, repo);
    case TOOL_NAMES.COMPARE_POLICIES:
      return handleComparePolicies(args, context);
    case TOOL_NAMES.SAVE_ITERATION:
      return handleSaveIteration(args, context, repo);
    case TOOL_NAMES.RETRIEVE_DOCUMENTS:
      return handleRetrieveDocuments(args);
    case TOOL_NAMES.COMPOSE_MAP_ACTIONS: {
      const parsed = z.object({ actions: z.array(z.unknown()) }).strict().parse(args);
      const validated = parseMapActions(parsed.actions);
      if (!validated.ok) {
        return {
          ok: false,
          accepted: [],
          rejected: validated.rejected,
          errors: validated.errors,
          note: "No valid map actions. Fix schema / Toronto scope and retry.",
        };
      }

      const accepted: MapAction[] = [];
      const rejected: unknown[] = [...validated.rejected];
      const errors: string[] = [...validated.errors];

      // Occupancy: prior agent drawings + twin POIs/corridors
      const occupancy: AgentMapOverlay[] = [
        ...context.agentOverlays,
        ...context.twin.pois.map(
          (p): AgentMapOverlay => ({
            kind: "point",
            id: `twin-poi:${p.id}`,
            coordinates: [p.lng, p.lat],
            label: p.label,
          }),
        ),
        ...context.twin.corridors.map(
          (c): AgentMapOverlay => ({
            kind: "line",
            id: `twin-corridor:${c.id}`,
            coordinates: c.alignment,
            label: c.label,
          }),
        ),
      ];

      for (const action of validated.actions) {
        if (
          action.type === "draw_point" ||
          action.type === "draw_line" ||
          action.type === "draw_polygon" ||
          action.type === "annotate"
        ) {
          const overlay = actionToOverlay(action);
          if (!overlay) {
            rejected.push(action);
            errors.push(`Could not materialize overlay for action ${action.type}`);
            continue;
          }
          if (occupancy.some((o) => o.id === overlay.id) || context.agentOverlays.some((o) => o.id === overlay.id)) {
            rejected.push(action);
            errors.push(`Overlay id "${overlay.id}" already exists on the map.`);
            continue;
          }
          const hit = findCollision(overlay, occupancy);
          if (hit) {
            rejected.push(action);
            errors.push(
              `Collision: "${overlay.id}" is within ${MAP_COLLISION_METERS}m of existing "${hit.id}" (${hit.kind}). Move it or remove the other overlay first.`,
            );
            continue;
          }
          context.agentOverlays.push(overlay);
          occupancy.push(overlay);
          accepted.push(action);
          continue;
        }

        if (action.type === "remove_overlays") {
          context.agentOverlays = context.agentOverlays.filter((o) => !action.ids.includes(o.id));
          accepted.push(action);
          continue;
        }

        if (action.type === "clear_map_overlays") {
          if (action.what === "all" || action.what === "drawings") {
            context.agentOverlays =
              action.what === "all"
                ? []
                : context.agentOverlays.filter((o) => o.kind === "annotation");
          }
          if (action.what === "annotations") {
            context.agentOverlays = context.agentOverlays.filter((o) => o.kind !== "annotation");
          }
          accepted.push(action);
          continue;
        }

        accepted.push(action);
      }

      // Append so multiple compose calls in one turn accumulate
      context.composedMapActions = [...context.composedMapActions, ...accepted];
      return {
        ok: errors.length === 0,
        accepted,
        rejected,
        errors,
        agentOverlays: context.agentOverlays,
        note:
          errors.length > 0
            ? "Some map actions were rejected (schema, Toronto scope, or collision). Frontend executes only accepted actions."
            : "Frontend remains the final executor of map actions.",
      };
    }
    case TOOL_NAMES.WRITE_MEMORY:
      return handleWriteMemory(args, context, assistantId);
    case TOOL_NAMES.CREATE_TRAINING:
      return handleCreateTraining(args, context, repo);
    case TOOL_NAMES.QUERY_TWIN: {
      const parsed = z
        .object({
          kind: z.string().optional(),
          neighbourhoodCode: z.string().optional(),
        })
        .strict()
        .parse(args ?? {});
      return {
        dataMode: "in-memory-twin",
        result: queryTwin(context.twin, parsed),
      };
    }
    case TOOL_NAMES.PATCH_TWIN: {
      const parsed = z.object({ patch: z.unknown() }).strict().parse(args);
      const patch = parseScenarioPatch(parsed.patch);
      const before = context.twin;
      context.twin = patchTwin(context.twin, patch);
      context.proposedCityPatches.push(patch);
      return {
        dataMode: "in-memory-twin",
        version: context.twin.version,
        diff: diffTwin(before, context.twin),
        patchId: patch.id,
      };
    }
    case TOOL_NAMES.SNAPSHOT_TWIN: {
      const key = `v${context.twin.version}`;
      context.twinSnapshots.set(key, structuredClone(context.twin));
      return { dataMode: "in-memory-twin", key, snapshot: context.twin };
    }
    case TOOL_NAMES.DIFF_TWIN: {
      const parsed = z.object({ against: z.string().optional() }).strict().parse(args ?? {});
      const againstKey = parsed.against ?? "baseline";
      const other =
        againstKey === "baseline"
          ? context.twinBaseline
          : context.twinSnapshots.get(againstKey) ?? context.twinBaseline;
      return { dataMode: "in-memory-twin", diff: diffTwin(other, context.twin) };
    }
    case TOOL_NAMES.PROPOSE_SCENARIOS: {
      const parsed = z
        .object({
          patches: z.array(z.unknown()).min(1),
          question: z.string().optional(),
        })
        .strict()
        .parse(args);
      let patches = parseScenarioPatches(parsed.patches);
      if (parsed.question) {
        const canned = matchCannedAsk(parsed.question);
        if (canned && patches.length === 0) patches = [...canned.patches];
      }
      context.proposedCityPatches = patches;
      return {
        dataMode: "in-memory-twin",
        count: patches.length,
        patchIds: patches.map((p) => p.id),
        patches,
      };
    }
    case TOOL_NAMES.SCORE_POPULATION: {
      const parsed = z
        .object({
          patch: z.unknown().optional(),
          question: z.string().min(1),
          scenarioId: z.string().optional(),
          neighbourhoodCodes: z.array(z.string()).optional(),
        })
        .strict()
        .parse(args);
      let scenarioId = parsed.scenarioId ?? `score-${context.twin.version}`;
      let policyText = parsed.question;
      if (parsed.patch) {
        const patch = parseScenarioPatch(parsed.patch);
        scenarioId = parsed.scenarioId ?? patch.id;
        policyText = policyTextForPatch(patch);
      }
      const score = await scoreRealPolicyAcceptance(scenarioId, policyText, {
        neighbourhoodCodes: parsed.neighbourhoodCodes,
        onPersonaScored: context.onPersonaScored,
      });
      // compact neighbourhood readout so the agent can reject weak local sites
      const nhRows = Object.entries(score.byNeighbourhood)
        .map(([code, v]) => ({ code, mean: v.mean, count: v.count }))
        .sort((a, b) => a.mean - b.mean);
      const weakest = nhRows.slice(0, 5);
      const strongest = nhRows.slice(-5).reverse();
      return {
        dataMode: "real-opinion-model",
        provider: score.provider,
        scenarioId: score.scenarioId,
        citywide: score.citywide,
        neighbourhoodCount: nhRows.length,
        weakestNeighbourhoods: weakest,
        strongestNeighbourhoods: strongest,
        note: `Real acceptance: adaptively Monte-Carlo-sampled real residents (${score.citywide.sampleSize} sampled, stopped because "${score.citywide.stopReason}", 95% CI ±${score.citywide.ciHalfWidth.toFixed(3)}) scored by the trained opinion model, not simulated public opinion or ridership. If citywide.stopReason is "max-sample" the CI may still be wide -- treat the mean cautiously. If weakestNeighbourhoods include your proposed site or citywide support is low, try other areas before recommending. Pass neighbourhoodCodes to score only the areas you're actually comparing instead of the whole city when you don't need a citywide read.`,
      };
    }
    case TOOL_NAMES.INVOKE_ASSISTANT: {
      const parsed = z
        .object({
          role: z.string().min(1),
          task: z.string().min(1),
        })
        .strict()
        .parse(args);
      if (!isTechTOAssistantKey(parsed.role)) {
        throw new ToolDispatchError(`Unknown assistant role "${parsed.role}"`);
      }
      if (parsed.role === "planning-orchestrator") {
        throw new ToolDispatchError("Cannot invoke the planning-orchestrator from itself.");
      }
      if (context.invokeDepth >= 1) {
        throw new ToolDispatchError("invoke_assistant nesting limit reached.");
      }
      context.invokedAssistants.push(parsed.role);
      context.invokeDepth += 1;
      const { resolveAssistant } = await import("@/lib/backboard/assistant-manifest");
      const { runToolLoop } = await import("@/lib/backboard/run-tool-loop");
      const resolved = await resolveAssistant(parsed.role, context.adapter);
      const loop = await runToolLoop({
        adapter: context.adapter,
        assistantId: resolved.record.assistantId,
        content: parsed.task,
        systemPrompt: resolved.role.systemPrompt,
        modelName: resolved.model.modelName,
        llmProvider: resolved.model.provider,
        tools: getToolDefinitions(resolved.role.toolNames.filter((n) => n !== TOOL_NAMES.INVOKE_ASSISTANT)),
        thinking: resolved.role.thinking,
        memory: resolved.role.memory,
        context,
        maxRounds: 4,
        jsonOutput: true,
        onToolCallStart: (call) => context.onNestedToolStart?.(call, parsed.role),
        onToolCallEnd: (outcome) => context.onNestedToolEnd?.(outcome, parsed.role),
      });
      context.invokeDepth -= 1;
      return {
        role: parsed.role,
        name: ASSISTANT_ROSTER[parsed.role].name,
        content: loop.finalResult.content,
        toolRounds: loop.rounds,
        toolsUsed: loop.toolCallLog.map((t) => t.toolName),
      };
    }
    case TOOL_NAMES.RUN_TWIN_ANALYSIS: {
      const parsed = z
        .object({
          analysis: z.enum(["population_score"]),
          question: z.string().min(1),
          scenarioId: z.string().optional(),
          neighbourhoodCodes: z.array(z.string()).optional(),
        })
        .strict()
        .parse(args);
      const score = await scoreRealPolicyAcceptance(
        parsed.scenarioId ?? `analysis-${context.twin.version}`,
        parsed.question,
        { neighbourhoodCodes: parsed.neighbourhoodCodes, onPersonaScored: context.onPersonaScored },
      );
      const nhRows = Object.entries(score.byNeighbourhood)
        .map(([code, v]) => ({ code, mean: v.mean, count: v.count }))
        .sort((a, b) => a.mean - b.mean);
      return {
        analysis: parsed.analysis,
        provider: score.provider,
        citywide: score.citywide,
        weakestNeighbourhoods: nhRows.slice(0, 5),
        strongestNeighbourhoods: nhRows.slice(-5).reverse(),
        note: `Real acceptance readout: adaptively Monte-Carlo-sampled real residents (${score.citywide.sampleSize} sampled, stopped because "${score.citywide.stopReason}", 95% CI ±${score.citywide.ciHalfWidth.toFixed(3)}) scored by the trained opinion model, not simulated public opinion or ridership. Weak local scores should trigger trying other sites. Pass neighbourhoodCodes to restrict sampling to specific areas instead of the whole city.`,
      };
    }
    case TOOL_NAMES.RUN_PYTHON: {
      const parsed = z
        .object({
          code: z.string().min(1).max(40_000),
          timeout_s: z.number().positive().max(30).optional(),
        })
        .strict()
        .parse(args);
      const timeoutMs = Math.round((parsed.timeout_s ?? 12) * 1000);
      const result = await runAgentPython({
        code: parsed.code,
        timeoutMs,
        twin: context.twin,
        overlays: context.agentOverlays,
        seed: 2262,
      });
      // keep model context lean: preview + clipped logs, drop libs dump
      const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
      return {
        ok: result.ok,
        error: result.error,
        result_preview: result.result_preview,
        stdout: clip(result.stdout || "", 2500),
        stderr: clip(result.stderr || "", 800),
        mongo_bound: result.mongo_bound,
      };
    }
    default:
      throw new ToolDispatchError(`Unknown tool: "${name}"`);
  }
}

function formatError(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Executes one tool call and never throws: failures (including an unknown
 * tool name) are captured as `{ ok: false, output: { error } }` so the
 * calling loop can feed the error back to the model as a normal tool output
 * instead of aborting the run.
 */
export async function dispatchToolCall(
  call: ChatToolCall,
  context: RunContext,
  assistantId: string,
): Promise<ToolCallOutcome> {
  try {
    const output = await executeTool(call.name, call.arguments, context, assistantId);
    void persistBackboardToolCall({
      runId: context.runId,
      assistantId,
      toolName: call.name,
      ok: true,
      argsSummary: JSON.stringify(call.arguments ?? {}).slice(0, 500),
    });
    return { toolCallId: call.id, toolName: call.name, ok: true, output };
  } catch (error) {
    void persistBackboardToolCall({
      runId: context.runId,
      assistantId,
      toolName: call.name,
      ok: false,
      argsSummary: formatError(error).slice(0, 500),
    });
    return {
      toolCallId: call.id,
      toolName: call.name,
      ok: false,
      output: { error: formatError(error) },
    };
  }
}
