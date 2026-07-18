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
import { listCohorts } from "@/data/transit/cohorts";
import { getScenario, getStressOverlay, listStressOverlays } from "@/data/transit/scenarios";
import { getTransitRepository, type TransitRepository } from "@/lib/transit/repository";
import { rankInterventions, type RankableIntervention } from "@/lib/transit/candidate-ranker";
import { simulateTransit } from "@/lib/transit/simulator";
import { stressTestIntervention, type StressTestOutcome } from "@/lib/transit/stress-tests";
import { transitInterventionSchema, type TransitIntervention, type TransitSimulationResult } from "@/lib/transit/schemas";

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
export interface RunContext {
  scenarioId: string;
  adapter: BackboardAdapter;
  simulationsByCandidateId: Map<string, CandidateSimulationState>;
  iterations: PolicyIterationRecord[];
}

export function createRunContext(scenarioId: string, adapter: BackboardAdapter): RunContext {
  return { scenarioId, adapter, simulationsByCandidateId: new Map(), iterations: [] };
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
): TransitSimulationResult {
  const scenario = getScenario(scenarioId);
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
    return { scenarioId, interventionId: null, departureLoads: repo.getDepartureLoads(scenarioId) };
  }
  const intervention = requireRegisteredIntervention(context, interventionId);
  const result = ensureSimulated(context, scenarioId, intervention);
  return { scenarioId, interventionId, departureLoads: result.departureLoads };
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
  const scenario = getScenario(scenarioId);
  if (!scenario) {
    throw new ToolDispatchError(`Unknown transit scenario id: "${scenarioId}".`);
  }
  if (!interventionId) {
    return repo.getStopCrowding(`${scenario.stationId}-platform`, scenarioId);
  }
  const intervention = requireRegisteredIntervention(context, interventionId);
  const result = ensureSimulated(context, scenarioId, intervention);
  const peakQueueLength = result.queueTrace.reduce((max, point) => Math.max(max, point.queueLength), 0);
  const peakLoad = result.departureLoads.reduce((max, load) => Math.max(max, load.loadFactor), 0);
  return {
    stopId: `${scenario.stationId}-platform`,
    stationId: scenario.stationId,
    routeId: scenario.routeId,
    peakQueueLength,
    loadFactorAtPeak: peakLoad,
    dataMode: "synthetic-fixture" as const,
  };
}

function handleGetTransferDemand(args: unknown, repo: TransitRepository) {
  const { scenarioId } = scenarioIdArgsSchema.parse(args);
  const scenario = getScenario(scenarioId);
  if (!scenario) {
    throw new ToolDispatchError(`Unknown transit scenario id: "${scenarioId}".`);
  }
  return repo.getTransferDemand(scenario.routeId);
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
  const scenario = getScenario(scenarioId);
  if (!scenario) {
    throw new ToolDispatchError(`Unknown transit scenario id: "${scenarioId}".`);
  }
  return repo.getAccessibilityConstraints(scenario.stationId);
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

function handleRunSimulation(args: unknown, context: RunContext) {
  const { scenarioId, intervention } = interventionEvalArgsSchema.parse(args);
  const scenario = getScenario(scenarioId);
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
  });
  state.visible = result;
  return result;
}

function handleCalculateWait(args: unknown, context: RunContext) {
  const { scenarioId, intervention } = interventionEvalArgsSchema.parse(args);
  const result = ensureSimulated(context, scenarioId, intervention);
  return {
    interventionId: intervention.id,
    valid: result.valid,
    meanWaitMinutes: result.metrics.meanWaitMinutes,
    p90WaitMinutes: result.metrics.p90WaitMinutes,
  };
}

function handleCalculateLoad(args: unknown, context: RunContext) {
  const { scenarioId, intervention } = interventionEvalArgsSchema.parse(args);
  const result = ensureSimulated(context, scenarioId, intervention);
  return {
    interventionId: intervention.id,
    valid: result.valid,
    loadImbalance: result.metrics.loadImbalance,
    deniedBoardings: result.metrics.deniedBoardings,
  };
}

function handleCalculateReliability(args: unknown, context: RunContext, repo: TransitRepository) {
  const { scenarioId, intervention } = interventionEvalArgsSchema.parse(args);
  const scenario = getScenario(scenarioId);
  const result = ensureSimulated(context, scenarioId, intervention);
  return {
    interventionId: intervention.id,
    valid: result.valid,
    missedTransfers: result.metrics.missedTransfers,
    recentDelayHistory: scenario ? repo.getDelayHistory(scenario.routeId) : [],
  };
}

function handleCalculateEquity(args: unknown, context: RunContext) {
  const { scenarioId, intervention } = interventionEvalArgsSchema.parse(args);
  const result = ensureSimulated(context, scenarioId, intervention);
  return { interventionId: intervention.id, valid: result.valid, equityGap: result.metrics.equityGap };
}

function handleCalculateAccessibility(args: unknown, context: RunContext) {
  const { scenarioId, intervention } = interventionEvalArgsSchema.parse(args);
  const result = ensureSimulated(context, scenarioId, intervention);
  return {
    interventionId: intervention.id,
    valid: result.valid,
    accessibilityFailures: result.metrics.accessibilityFailures,
    violations: result.violations.filter((violation) => violation.code.startsWith("accessibility")),
  };
}

function handleCalculateCost(args: unknown, context: RunContext) {
  const { scenarioId, intervention } = interventionEvalArgsSchema.parse(args);
  const result = ensureSimulated(context, scenarioId, intervention);
  return { interventionId: intervention.id, valid: result.valid, operatingCostScore: result.metrics.operatingCostScore };
}

function handleCalculateCarbon(args: unknown, context: RunContext) {
  const { scenarioId, intervention } = interventionEvalArgsSchema.parse(args);
  const result = ensureSimulated(context, scenarioId, intervention);
  return {
    interventionId: intervention.id,
    valid: result.valid,
    estimatedCarTrips: result.metrics.estimatedCarTrips,
    estimatedCarbonKg: result.metrics.estimatedCarbonKg,
  };
}

function handleStressTest(args: unknown, context: RunContext) {
  const { scenarioId, intervention, stressOverlayId } = stressTestArgsSchema.parse(args);
  const scenario = getScenario(scenarioId);
  if (!scenario) {
    throw new ToolDispatchError(`Unknown transit scenario id: "${scenarioId}".`);
  }
  const overlay = stressOverlayId ? getStressOverlay(stressOverlayId) : listStressOverlays()[0];
  if (!overlay) {
    throw new ToolDispatchError(
      stressOverlayId
        ? `Unknown transit stress overlay id: "${stressOverlayId}".`
        : "No stress overlay is registered for this scenario.",
    );
  }
  const state = candidateState(context, intervention.id);
  state.intervention = intervention;
  const outcome = stressTestIntervention(scenario, intervention, overlay, TOOL_DISPATCH_SEED);
  state.visible = state.visible ?? outcome.baseline;
  state.stress = outcome;
  return outcome;
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

function handleSaveIteration(args: unknown, context: RunContext) {
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
  return { saved: true, iterationCount: context.iterations.length, record };
}

// ---------------------------------------------------------------------------
// Citizen reaction model
// ---------------------------------------------------------------------------

async function handleCallCitizenModel(args: unknown, context: RunContext) {
  const parsed = callCitizenModelArgsSchema.parse(args);
  const provider = getCitizenReactionProvider();
  const result = await provider.predictBatch(parsed);
  const interventionId = parsed.intervention.id ?? parsed.intervention.title;
  const state = candidateState(context, interventionId);
  state.citizenReactions = result;
  return result;
}

function computeReactionAggregate(
  reactions: z.output<typeof citizenReactionSchema>[],
): CitizenReactionAggregate {
  const weightByCohortId = new Map(listCohorts().map((cohort) => [cohort.id, cohort.weight]));
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

function handleAggregateReactions(args: unknown) {
  const { scenarioId, reactions } = aggregateReactionsArgsSchema.parse(args);
  return { scenarioId, aggregate: computeReactionAggregate(reactions) };
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

function handleCreateTraining(args: unknown, context: RunContext) {
  const { scenarioId, interventionId, label } = createTrainingArgsSchema.parse(args);
  const state = context.simulationsByCandidateId.get(interventionId);
  if (!state?.intervention || !state.visible) {
    throw new ToolDispatchError(
      `Intervention "${interventionId}" has not been simulated yet; nothing reviewed to package into training rows.`,
    );
  }
  return {
    label,
    rowCount: 1,
    rows: [
      {
        input: { scenarioId, intervention: state.intervention },
        output: { metrics: state.visible.metrics, valid: state.visible.valid },
        metadata: {
          citizenReactions: state.citizenReactions ?? null,
          stress: state.stress ? { invalidated: state.stress.invalidated } : null,
        },
      },
    ],
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
  const repo = getTransitRepository();

  switch (name as ToolName) {
    case TOOL_NAMES.GET_NETWORK_SNAPSHOT:
      return handleGetNetworkSnapshot(repo);
    case TOOL_NAMES.GET_ROUTE_SCHEDULE:
      return handleGetRouteSchedule(args, repo);
    case TOOL_NAMES.GET_DEPARTURE_LOADS:
      return handleGetDepartureLoads(args, repo, context);
    case TOOL_NAMES.GET_PASSENGER_ARRIVALS:
      return handleGetPassengerArrivals(args, repo);
    case TOOL_NAMES.GET_OD_FLOWS:
      return handleGetOdFlows(args, repo);
    case TOOL_NAMES.GET_STOP_CROWDING:
      return handleGetStopCrowding(args, repo, context);
    case TOOL_NAMES.GET_TRANSFER_DEMAND:
      return handleGetTransferDemand(args, repo);
    case TOOL_NAMES.GET_DELAY_HISTORY:
      return handleGetDelayHistory(args, repo);
    case TOOL_NAMES.GET_VEHICLE_CAPACITY:
      return handleGetVehicleCapacity(args, repo);
    case TOOL_NAMES.GET_FLEET_AVAILABILITY:
      return handleGetFleetAvailability(args, repo);
    case TOOL_NAMES.GET_DEMOGRAPHICS:
      return handleGetDemographics(args, repo);
    case TOOL_NAMES.GET_ACCESSIBILITY:
      return handleGetAccessibility(args, repo);
    case TOOL_NAMES.GET_EVENT_CONTEXT:
      return handleGetEventContext(repo);
    case TOOL_NAMES.GET_WEATHER_CONTEXT:
      return handleGetWeatherContext(repo);
    case TOOL_NAMES.GET_INCIDENTS:
      return handleGetIncidents(args, repo);
    case TOOL_NAMES.FIND_SIMILAR:
      return handleFindSimilar(args, repo);
    case TOOL_NAMES.PROPOSE_VARIANTS:
      return handleProposeVariants(args, context);
    case TOOL_NAMES.CALL_CITIZEN_MODEL:
      return handleCallCitizenModel(args, context);
    case TOOL_NAMES.AGGREGATE_REACTIONS:
      return handleAggregateReactions(args);
    case TOOL_NAMES.RUN_SIMULATION:
      return handleRunSimulation(args, context);
    case TOOL_NAMES.CALCULATE_WAIT:
      return handleCalculateWait(args, context);
    case TOOL_NAMES.CALCULATE_LOAD:
      return handleCalculateLoad(args, context);
    case TOOL_NAMES.CALCULATE_RELIABILITY:
      return handleCalculateReliability(args, context, repo);
    case TOOL_NAMES.CALCULATE_EQUITY:
      return handleCalculateEquity(args, context);
    case TOOL_NAMES.CALCULATE_ACCESSIBILITY:
      return handleCalculateAccessibility(args, context);
    case TOOL_NAMES.CALCULATE_COST:
      return handleCalculateCost(args, context);
    case TOOL_NAMES.CALCULATE_CARBON:
      return handleCalculateCarbon(args, context);
    case TOOL_NAMES.STRESS_TEST:
      return handleStressTest(args, context);
    case TOOL_NAMES.COMPARE_POLICIES:
      return handleComparePolicies(args, context);
    case TOOL_NAMES.SAVE_ITERATION:
      return handleSaveIteration(args, context);
    case TOOL_NAMES.RETRIEVE_DOCUMENTS:
      return handleRetrieveDocuments(args);
    case TOOL_NAMES.WRITE_MEMORY:
      return handleWriteMemory(args, context, assistantId);
    case TOOL_NAMES.CREATE_TRAINING:
      return handleCreateTraining(args, context);
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
    return { toolCallId: call.id, toolName: call.name, ok: true, output };
  } catch (error) {
    return {
      toolCallId: call.id,
      toolName: call.name,
      ok: false,
      output: { error: formatError(error) },
    };
  }
}
