import { z } from "zod";

import type { BackboardAdapter, ChatToolCall } from "@/lib/backboard/client";
import { TOOL_NAMES, type ToolName } from "@/lib/backboard/tools";
import { rankCandidates, type RankableCandidate } from "@/lib/grid/candidate-ranker";
import { findSimilarScenarios, requireAsset, withFixtureEnvelope } from "@/lib/grid/fixtures";
import { dispatchPlanSchema } from "@/lib/grid/schemas";
import { resolveScenarioConditions } from "@/lib/grid/scenarios";
import type { SimulationResult } from "@/lib/grid/types";
import { simulateDispatchPlan } from "@/lib/grid/simulator";
import { validateDispatchPlan } from "@/lib/grid/validator";

export class ToolDispatchError extends Error {}

export interface CandidateSimulations {
  visible?: SimulationResult;
  stress?: SimulationResult;
}

/**
 * Per-run, in-memory state shared across every tool call in one orchestration
 * run (never persisted; a fresh context is created per run). This is what
 * lets rank_dispatch_candidates reference simulations performed earlier in
 * the same run without the model having to echo huge payloads back.
 */
export interface RunContext {
  assetId: string;
  scenarioId: string;
  adapter: BackboardAdapter;
  simulationsByCandidateId: Map<string, CandidateSimulations>;
}

export function createRunContext(assetId: string, scenarioId: string, adapter: BackboardAdapter): RunContext {
  return { assetId, scenarioId, adapter, simulationsByCandidateId: new Map() };
}

export interface ToolCallOutcome {
  toolCallId: string;
  toolName: string;
  ok: boolean;
  output: unknown;
}

const assetSpecArgsSchema = z.object({ assetId: z.string().min(1) }).strict();

const scenarioAssetArgsSchema = z
  .object({ assetId: z.string().min(1), scenarioId: z.string().min(1) })
  .strict();

const similarScenariosArgsSchema = z
  .object({
    scenarioType: z.string().min(1).optional(),
    tags: z.array(z.string().min(1)).max(10).optional(),
    limit: z.number().int().positive().max(10).optional(),
  })
  .strict();

const planEvaluationArgsSchema = z
  .object({
    assetId: z.string().min(1),
    scenarioId: z.string().min(1),
    candidateId: z.string().min(1),
    plan: dispatchPlanSchema,
  })
  .strict();

const rankArgsSchema = z
  .object({
    assetId: z.string().min(1),
    scenarioId: z.string().min(1),
    candidateIds: z.array(z.string().min(1)).min(1).max(10),
  })
  .strict();

const recallArgsSchema = z.object({ query: z.string().min(1) }).strict();

function handleGetAssetSpec(args: unknown) {
  const { assetId } = assetSpecArgsSchema.parse(args);
  return requireAsset(assetId);
}

function handleGetMarketWindow(args: unknown) {
  const { assetId, scenarioId } = scenarioAssetArgsSchema.parse(args);
  const asset = requireAsset(assetId);
  const conditions = resolveScenarioConditions(scenarioId, asset);
  const hours = conditions.visibleHours.map((hour) => ({
    hour: hour.hour,
    timestamp: hour.timestamp,
    priceCadPerMwh: hour.priceCadPerMwh,
    demandMw: hour.demandMw,
    reservePriceCadPerMwh: hour.reservePriceCadPerMwh,
    marginalEmissionsKgPerMwh: hour.marginalEmissionsKgPerMwh,
  }));
  return withFixtureEnvelope(hours, scenarioId, TOOL_NAMES.GET_MARKET_WINDOW);
}

function handleGetRenewableForecast(args: unknown) {
  const { assetId, scenarioId } = scenarioAssetArgsSchema.parse(args);
  const asset = requireAsset(assetId);
  const conditions = resolveScenarioConditions(scenarioId, asset);
  const hours = conditions.visibleHours.map((hour) => ({
    hour: hour.hour,
    timestamp: hour.timestamp,
    windMw: hour.windMw,
    solarMw: hour.solarMw,
    ambientTemperatureC: hour.ambientTemperatureC,
  }));
  return withFixtureEnvelope(hours, scenarioId, TOOL_NAMES.GET_RENEWABLE_FORECAST);
}

function handleGetSimilarScenarios(args: unknown) {
  const query = similarScenariosArgsSchema.parse(args);
  return { records: findSimilarScenarios(query) };
}

function handleValidateDispatchPlan(args: unknown) {
  const { assetId, scenarioId, candidateId, plan } = planEvaluationArgsSchema.parse(args);
  const asset = requireAsset(assetId);
  const conditions = resolveScenarioConditions(scenarioId, asset);
  const outcome = validateDispatchPlan(plan, asset, conditions.visibleHours);
  const valid = !outcome.violations.some((violation) => violation.severity === "error");
  return { candidateId, valid, violations: outcome.violations };
}

function handleSimulateDispatchPlan(args: unknown, context: RunContext) {
  const { assetId, scenarioId, candidateId, plan } = planEvaluationArgsSchema.parse(args);
  const asset = requireAsset(assetId);
  const conditions = resolveScenarioConditions(scenarioId, asset);
  const result = simulateDispatchPlan(plan, asset, conditions.visibleHours);
  const existing = context.simulationsByCandidateId.get(candidateId) ?? {};
  context.simulationsByCandidateId.set(candidateId, { ...existing, visible: result });
  return { candidateId, ...result };
}

function handleStressTestDispatchPlan(args: unknown, context: RunContext) {
  const { assetId, scenarioId, candidateId, plan } = planEvaluationArgsSchema.parse(args);
  const asset = requireAsset(assetId);
  const conditions = resolveScenarioConditions(scenarioId, asset);
  const result = simulateDispatchPlan(plan, asset, conditions.actualHours);
  const existing = context.simulationsByCandidateId.get(candidateId) ?? {};
  context.simulationsByCandidateId.set(candidateId, { ...existing, stress: result });
  return {
    candidateId,
    ...result,
    hiddenStressDescription: conditions.hiddenStressDescription,
  };
}

function handleRankDispatchCandidates(args: unknown, context: RunContext) {
  const { candidateIds } = rankArgsSchema.parse(args);
  const rankable: RankableCandidate[] = candidateIds.map((candidateId) => {
    const entry = context.simulationsByCandidateId.get(candidateId);
    if (!entry?.visible) {
      throw new ToolDispatchError(
        `Candidate "${candidateId}" has not been simulated yet. Call simulate_dispatch_plan for it first.`,
      );
    }
    return { candidateId, result: entry.visible };
  });
  return { ranked: rankCandidates(rankable) };
}

async function handleRecallOperatorNotes(args: unknown, context: RunContext, assistantId: string) {
  const { query } = recallArgsSchema.parse(args);
  const memories = await context.adapter.searchMemories(assistantId, query, 5);
  return { query, memories };
}

async function executeTool(name: string, args: unknown, context: RunContext, assistantId: string): Promise<unknown> {
  switch (name as ToolName) {
    case TOOL_NAMES.GET_ASSET_SPEC:
      return handleGetAssetSpec(args);
    case TOOL_NAMES.GET_MARKET_WINDOW:
      return handleGetMarketWindow(args);
    case TOOL_NAMES.GET_RENEWABLE_FORECAST:
      return handleGetRenewableForecast(args);
    case TOOL_NAMES.GET_SIMILAR_SCENARIOS:
      return handleGetSimilarScenarios(args);
    case TOOL_NAMES.VALIDATE_DISPATCH_PLAN:
      return handleValidateDispatchPlan(args);
    case TOOL_NAMES.SIMULATE_DISPATCH_PLAN:
      return handleSimulateDispatchPlan(args, context);
    case TOOL_NAMES.STRESS_TEST_DISPATCH_PLAN:
      return handleStressTestDispatchPlan(args, context);
    case TOOL_NAMES.RANK_DISPATCH_CANDIDATES:
      return handleRankDispatchCandidates(args, context);
    case TOOL_NAMES.RECALL_OPERATOR_NOTES:
      return handleRecallOperatorNotes(args, context, assistantId);
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
 * Executes one tool call and never throws: failures are captured as
 * `{ ok: false, output: { error } }` so the calling loop can feed the error
 * back to the model as a normal tool output instead of aborting the run.
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
