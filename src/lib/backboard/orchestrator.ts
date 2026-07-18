import { z } from "zod";

import { getBackboardAdapter } from "@/lib/backboard/adapter";
import { resolveAssistant } from "@/lib/backboard/assistant-manifest";
import type {
  AssistantRoleKey,
} from "@/lib/backboard/assistants";
import type {
  BackboardAdapter,
  ChatToolCall,
  ChatToolDefinition,
  MemoryMode,
  ThinkingConfig,
} from "@/lib/backboard/client";
import { runToolLoop, type RunToolLoopResult } from "@/lib/backboard/run-tool-loop";
import { createRunContext, type RunContext, type ToolCallOutcome } from "@/lib/backboard/tool-dispatcher";
import { getToolDefinitions } from "@/lib/backboard/tools";
import { rankCandidates } from "@/lib/grid/candidate-ranker";
import { requireAsset, requireScenario } from "@/lib/grid/fixtures";
import {
  analystFindingSchema,
  dispatchPlanSchema,
  finalRecommendationSchema,
  riskReviewSchema,
  type AnalystFinding,
  type DispatchPlanParsed,
  type FinalRecommendation,
  type RiskReview,
} from "@/lib/grid/schemas";
import { resolveScenarioConditions } from "@/lib/grid/scenarios";
import { simulateDispatchPlan } from "@/lib/grid/simulator";
import type {
  BatteryAsset,
  ConditionHour,
  ObjectiveWeights,
  RankedCandidate,
  ScenarioDefinition,
  SimulationResult,
} from "@/lib/grid/types";

export class OrchestrationError extends Error {}

export type EvidenceSource = "agent" | "local_fallback";

export interface CandidateOutcome {
  candidateId: string;
  plan: DispatchPlanParsed;
  simulation: SimulationResult;
  simulationSource: EvidenceSource;
  stressSimulation: SimulationResult;
  stressSimulationSource: EvidenceSource;
}

/**
 * Frontend-safe event stream for one orchestration run. Deliberately coarser
 * than Backboard's raw token stream: only agent/tool lifecycle and grid-domain
 * evidence cross this boundary, never raw reasoning or chain-of-thought text.
 */
export type GridRunEvent =
  | { type: "run.created"; runId: string; assetId: string; scenarioId: string }
  | { type: "agent.started"; runId: string; role: AssistantRoleKey; name: string }
  | { type: "agent.completed"; runId: string; role: AssistantRoleKey; name: string; summary: string }
  | { type: "agent.failed"; runId: string; role: AssistantRoleKey; name: string; error: string }
  | { type: "tool.requested"; runId: string; role: AssistantRoleKey; toolName: string }
  | { type: "tool.completed"; runId: string; role: AssistantRoleKey; toolName: string; ok: boolean }
  | { type: "candidate.created"; runId: string; candidateId: string; strategy: string }
  | {
      type: "candidate.simulated";
      runId: string;
      candidateId: string;
      valid: boolean;
      netValueCad: number;
      source: EvidenceSource;
    }
  | { type: "candidate.stress_tested"; runId: string; candidateId: string; valid: boolean; source: EvidenceSource }
  | { type: "candidates.ranked"; runId: string; ranking: RankedCandidate[] }
  | {
      type: "recommendation.ready";
      runId: string;
      recommendation: FinalRecommendation;
      overridden: boolean;
      overrideReason?: string;
    }
  | { type: "run.completed"; runId: string; result: GridRunResult }
  | { type: "run.failed"; runId: string; error: string };

export interface GridRunResult {
  runId: string;
  assetId: string;
  scenarioId: string;
  marketFinding: AnalystFinding;
  renewableFinding: AnalystFinding;
  candidates: CandidateOutcome[];
  riskReviews: RiskReview[];
  ranking: RankedCandidate[];
  /** Verbatim structured output from the Chief Dispatch Officer, kept for audit even when overridden. */
  aiRecommendation: FinalRecommendation;
  /** What the UI should actually act on: identical to aiRecommendation unless a hard safety override fired. */
  effectiveRecommendation: FinalRecommendation;
  recommendationOverridden: boolean;
  overrideReason: string | null;
  /** True when the AI chose a valid candidate that is not the deterministic rank-1 (soft signal, not an override). */
  rankDisagreement: boolean;
  chiefAssistantId: string;
  chiefThreadId: string;
  hiddenStressDescription: string | null;
}

export interface RunOrchestrationInput {
  assetId: string;
  scenarioId: string;
  objectiveWeights?: ObjectiveWeights;
  adapter?: BackboardAdapter;
  onEvent?: (event: GridRunEvent) => void;
}

function generateRunId(): string {
  return `run-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

function formatZodError(error: z.ZodError): string {
  return error.issues.map((issue) => `- ${issue.path.join(".") || "(root)"}: ${issue.message}`).join("\n");
}

interface StructuredTurnParams<T> {
  adapter: BackboardAdapter;
  assistantId: string;
  content: string;
  systemPrompt?: string;
  modelName?: string;
  llmProvider?: string;
  tools?: ChatToolDefinition[];
  thinking?: ThinkingConfig;
  memory?: MemoryMode;
  context: RunContext;
  schema: z.ZodType<T>;
  maxRounds?: number;
  maxRetries?: number;
  onToolCallStart?: (call: ChatToolCall) => void;
  onToolCallEnd?: (outcome: ToolCallOutcome) => void;
}

interface StructuredTurnResult<T> {
  value: T;
  result: RunToolLoopResult;
}

type ParseAttempt<T> = { ok: true; value: T } | { ok: false; error: string };

function parseStructuredContent<T>(raw: string | null, schema: z.ZodType<T>): ParseAttempt<T> {
  if (!raw || raw.trim().length === 0) {
    return { ok: false, error: "The response content was empty." };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    return { ok: false, error: `The response was not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, error: formatZodError(parsed.error) };
  }
  return { ok: true, value: parsed.data };
}

/**
 * Sends one message expecting strict JSON matching `schema`. On a parse or
 * validation failure, feeds the exact issues back on the same thread and
 * retries up to `maxRetries` times before giving up.
 */
async function runStructuredTurn<T>(params: StructuredTurnParams<T>): Promise<StructuredTurnResult<T>> {
  const maxRetries = params.maxRetries ?? 1;
  const toolCallLog: ToolCallOutcome[] = [];

  let loopResult = await runToolLoop({
    adapter: params.adapter,
    assistantId: params.assistantId,
    content: params.content,
    systemPrompt: params.systemPrompt,
    modelName: params.modelName,
    llmProvider: params.llmProvider,
    tools: params.tools,
    thinking: params.thinking,
    memory: params.memory,
    jsonOutput: true,
    context: params.context,
    maxRounds: params.maxRounds,
    onToolCallStart: params.onToolCallStart,
    onToolCallEnd: params.onToolCallEnd,
  });
  toolCallLog.push(...loopResult.toolCallLog);
  let attempt = parseStructuredContent(loopResult.finalResult.content, params.schema);

  let retries = 0;
  while (!attempt.ok && retries < maxRetries) {
    retries += 1;
    const correction = `Your previous JSON response had the following problem(s):\n${attempt.error}\n\nReply again with ONLY the corrected, complete JSON object matching the required schema. Do not include any prose outside the JSON.`;
    loopResult = await runToolLoop({
      adapter: params.adapter,
      assistantId: params.assistantId,
      threadId: loopResult.finalResult.threadId,
      content: correction,
      systemPrompt: params.systemPrompt,
      modelName: params.modelName,
      llmProvider: params.llmProvider,
      tools: params.tools,
      thinking: params.thinking,
      memory: params.memory,
      jsonOutput: true,
      context: params.context,
      maxRounds: params.maxRounds,
      onToolCallStart: params.onToolCallStart,
      onToolCallEnd: params.onToolCallEnd,
    });
    toolCallLog.push(...loopResult.toolCallLog);
    attempt = parseStructuredContent(loopResult.finalResult.content, params.schema);
  }

  if (!attempt.ok) {
    throw new OrchestrationError(
      `Assistant ${params.assistantId} did not return valid structured output after ${retries + 1} attempt(s): ${attempt.error}`,
    );
  }

  return { value: attempt.value, result: { ...loopResult, toolCallLog } };
}

function buildAnalystPrompt(
  role: "market-analyst" | "renewable-analyst",
  asset: BatteryAsset,
  scenario: ScenarioDefinition,
): string {
  const focus =
    role === "market-analyst"
      ? "the visible market conditions (energy price, demand, reserve price, marginal emissions)"
      : "the visible renewable generation forecast (wind, solar, ambient temperature)";

  return `
Asset: ${asset.id} (${asset.name}) on the ${asset.market} market.
Scenario: ${scenario.id} - ${scenario.name}.
Scenario description: ${scenario.description}

Call your tool(s) to fetch ${focus} for exactly assetId "${asset.id}" and scenarioId "${scenario.id}", then
respond with ONLY JSON matching this schema (no prose outside the JSON):
{"role": string, "headline": string, "summary": string, "keySignals": string[], "confidence": number between 0 and 1}
`.trim();
}

function buildDispatchPlannerPrompt(params: {
  asset: BatteryAsset;
  scenario: ScenarioDefinition;
  visibleHours: ConditionHour[];
  marketFinding: AnalystFinding;
  renewableFinding: AnalystFinding;
}): string {
  const hourTable = params.visibleHours.map((hour) => `  hour ${hour.hour}: ${hour.timestamp}`).join("\n");

  return `
Asset: ${params.asset.id} (${params.asset.name}).
Scenario: ${params.scenario.id} - ${params.scenario.name}.
Scenario description: ${params.scenario.description}

Market Analyst finding:
${JSON.stringify(params.marketFinding)}

Renewable Analyst finding:
${JSON.stringify(params.renewableFinding)}

Call get_asset_spec for "${params.asset.id}" to confirm exact power, energy, SOC, ramp, and reserve limits before
proposing intervals.

Propose 2-3 candidate dispatch plans as JSON matching:
{"candidates": [{"candidateId": string, "plan": DispatchPlan}]}

Every plan must:
- set schemaVersion to 1, assetId to "${params.asset.id}", scenarioId to "${params.scenario.id}"
- set intervalMinutes to ${params.visibleHours.length > 0 ? "the value matching the hour list below" : "60"}
- contain exactly ${params.visibleHours.length} intervals, in order, one per hour below, each with the EXACT
  timestamp shown (do not shift, round, or reformat these timestamps):
${hourTable}
- give each candidate a short, unique, memorable candidateId (e.g. "conservative", "aggressive", "balanced")
- give "strategy" a SHORT label, at most 15 words and well under 150 characters (e.g. "Charge overnight
  wind surplus, discharge into the evening peak"); put any longer explanation in "assumptions" instead
- explore genuinely different strategies, not minor variations of the same plan

Respond with ONLY the JSON object, no prose outside it.
`.trim();
}

function buildRiskReviewerPrompt(params: {
  asset: BatteryAsset;
  scenario: ScenarioDefinition;
  candidates: { candidateId: string; plan: DispatchPlanParsed }[];
}): string {
  const candidateBlocks = params.candidates
    .map((candidate) => `Candidate "${candidate.candidateId}":\n${JSON.stringify(candidate.plan)}`)
    .join("\n\n");

  return `
Asset: ${params.asset.id} (${params.asset.name}).
Scenario: ${params.scenario.id} - ${params.scenario.name}.

Review these ${params.candidates.length} candidate dispatch plans:

${candidateBlocks}

For EACH candidate, call validate_dispatch_plan and simulate_dispatch_plan (assetId "${params.asset.id}",
scenarioId "${params.scenario.id}", the candidateId shown above, and the exact plan JSON shown above), then call
stress_test_dispatch_plan for the same candidate. You may call these for several different candidates within the
same turn. Once every candidate has been simulated and stress-tested, call rank_dispatch_candidates exactly once
with all candidateIds together.

After your tool calls are complete, respond with ONLY JSON matching:
{"reviews": [{"candidateId": string, "riskLevel": "low"|"medium"|"high", "summary": string, "concerns": string[], "recommendation": "approve"|"approve_with_caution"|"reject"}]}
Include exactly one review per candidate, using the exact candidateId values above.
`.trim();
}

function buildChiefPrompt(params: {
  asset: BatteryAsset;
  scenario: ScenarioDefinition;
  marketFinding: AnalystFinding;
  renewableFinding: AnalystFinding;
  candidates: CandidateOutcome[];
  riskReviews: RiskReview[];
  ranking: RankedCandidate[];
}): string {
  const candidateSummaries = params.candidates
    .map((candidate) => {
      const rank = params.ranking.find((entry) => entry.candidateId === candidate.candidateId);
      return (
        `Candidate "${candidate.candidateId}" (${candidate.plan.strategy}): ` +
        `netValueCad=${candidate.simulation.metrics.netValueCad.toFixed(2)}, ` +
        `renewableCapturedMwh=${candidate.simulation.metrics.renewableCapturedMwh.toFixed(2)}, ` +
        `carbonAvoidedKg=${candidate.simulation.metrics.carbonAvoidedKg.toFixed(2)}, ` +
        `degradationCostCad=${candidate.simulation.metrics.degradationCostCad.toFixed(2)}, ` +
        `visibleValid=${candidate.simulation.valid}, stressValid=${candidate.stressSimulation.valid}, ` +
        `deterministicRank=${rank?.rank ?? "n/a"}, disqualified=${rank?.disqualified ?? true}`
      );
    })
    .join("\n");

  return `
Asset: ${params.asset.id} (${params.asset.name}).
Scenario: ${params.scenario.id} - ${params.scenario.name}.

Market Analyst finding:
${JSON.stringify(params.marketFinding)}

Renewable Analyst finding:
${JSON.stringify(params.renewableFinding)}

Candidate simulation summary (from the deterministic simulator/ranker, not your own arithmetic):
${candidateSummaries}

Risk & Compliance review:
${JSON.stringify(params.riskReviews)}

Deterministic ranking (rank 1 = best; disqualified candidates failed hard validation and must never be recommended):
${JSON.stringify(params.ranking)}

Choose one candidate and respond with ONLY JSON matching:
{"chosenCandidateId": string, "headline": string, "reasoning": string, "tradeoffs": string[], "confidence": number between 0 and 1, "recommendedAction": "approve"|"approve_with_monitoring"|"hold_for_operator"}

Never choose a disqualified candidateId. If every candidate is disqualified, or the risk review found unresolved
high risk everywhere, use recommendedAction "hold_for_operator".
`.trim();
}

function buildDispatchCandidatesSchema(params: {
  assetId: string;
  scenarioId: string;
  intervalMinutes: number;
  expectedTimestamps: string[];
}) {
  const candidateSchema = z
    .object({
      candidateId: z.string().min(1).max(60),
      plan: dispatchPlanSchema,
    })
    .strict()
    .superRefine((candidate, ctx) => {
      if (candidate.plan.assetId !== params.assetId) {
        ctx.addIssue({
          code: "custom",
          message: `plan.assetId must be "${params.assetId}", got "${candidate.plan.assetId}".`,
          path: ["plan", "assetId"],
        });
      }
      if (candidate.plan.scenarioId !== params.scenarioId) {
        ctx.addIssue({
          code: "custom",
          message: `plan.scenarioId must be "${params.scenarioId}", got "${candidate.plan.scenarioId}".`,
          path: ["plan", "scenarioId"],
        });
      }
      if (candidate.plan.intervalMinutes !== params.intervalMinutes) {
        ctx.addIssue({
          code: "custom",
          message: `plan.intervalMinutes must be ${params.intervalMinutes}, got ${candidate.plan.intervalMinutes}.`,
          path: ["plan", "intervalMinutes"],
        });
      }
      if (candidate.plan.intervals.length !== params.expectedTimestamps.length) {
        ctx.addIssue({
          code: "custom",
          message: `plan.intervals must have exactly ${params.expectedTimestamps.length} entries (one per hour), got ${candidate.plan.intervals.length}.`,
          path: ["plan", "intervals"],
        });
        return;
      }
      candidate.plan.intervals.forEach((interval, index) => {
        if (interval.timestamp !== params.expectedTimestamps[index]) {
          ctx.addIssue({
            code: "custom",
            message: `intervals[${index}].timestamp must be exactly "${params.expectedTimestamps[index]}", got "${interval.timestamp}".`,
            path: ["plan", "intervals", index, "timestamp"],
          });
        }
      });
    });

  return z
    .object({ candidates: z.array(candidateSchema).min(2).max(3) })
    .strict()
    .refine(
      (data) => new Set(data.candidates.map((candidate) => candidate.candidateId)).size === data.candidates.length,
      { message: "candidateId values must be unique across candidates.", path: ["candidates"] },
    );
}

function buildRiskReviewsSchema(candidateIds: string[]) {
  return z
    .object({ reviews: z.array(riskReviewSchema).min(1) })
    .strict()
    .superRefine((data, ctx) => {
      const seen = new Set<string>();
      data.reviews.forEach((review, index) => {
        if (!candidateIds.includes(review.candidateId)) {
          ctx.addIssue({
            code: "custom",
            message: `Unknown candidateId "${review.candidateId}"; expected one of: ${candidateIds.join(", ")}.`,
            path: ["reviews", index, "candidateId"],
          });
        }
        seen.add(review.candidateId);
      });
      for (const id of candidateIds) {
        if (!seen.has(id)) {
          ctx.addIssue({ code: "custom", message: `Missing a review for candidateId "${id}".`, path: ["reviews"] });
        }
      }
    });
}

function buildFinalRecommendationSchema(candidateIds: string[]) {
  return finalRecommendationSchema.superRefine((data, ctx) => {
    if (!candidateIds.includes(data.chosenCandidateId)) {
      ctx.addIssue({
        code: "custom",
        message: `chosenCandidateId must be one of: ${candidateIds.join(", ")}.`,
        path: ["chosenCandidateId"],
      });
    }
  });
}

interface AnalystOutcome {
  finding: AnalystFinding;
  threadId: string;
}

async function runAnalyst(params: {
  adapter: BackboardAdapter;
  context: RunContext;
  role: "market-analyst" | "renewable-analyst";
  asset: BatteryAsset;
  scenario: ScenarioDefinition;
  runId: string;
  emit: (event: GridRunEvent) => void;
}): Promise<AnalystOutcome> {
  const resolved = await resolveAssistant(params.role, params.adapter);
  params.emit({ type: "agent.started", runId: params.runId, role: params.role, name: resolved.role.name });

  try {
    const prompt = buildAnalystPrompt(params.role, params.asset, params.scenario);
    const turn = await runStructuredTurn({
      adapter: params.adapter,
      assistantId: resolved.record.assistantId,
      content: prompt,
      systemPrompt: resolved.role.systemPrompt,
      modelName: resolved.model.modelName,
      llmProvider: resolved.model.provider,
      tools: getToolDefinitions(resolved.role.toolNames),
      thinking: resolved.role.thinking,
      memory: resolved.role.memory,
      context: params.context,
      schema: analystFindingSchema,
      onToolCallStart: (call) =>
        params.emit({ type: "tool.requested", runId: params.runId, role: params.role, toolName: call.name }),
      onToolCallEnd: (outcome) =>
        params.emit({
          type: "tool.completed",
          runId: params.runId,
          role: params.role,
          toolName: outcome.toolName,
          ok: outcome.ok,
        }),
    });
    params.emit({
      type: "agent.completed",
      runId: params.runId,
      role: params.role,
      name: resolved.role.name,
      summary: turn.value.headline,
    });
    return { finding: turn.value, threadId: turn.result.finalResult.threadId };
  } catch (error) {
    params.emit({
      type: "agent.failed",
      runId: params.runId,
      role: params.role,
      name: resolved.role.name,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

interface SafetyOverrideOutcome {
  effectiveRecommendation: FinalRecommendation;
  overridden: boolean;
  overrideReason: string | null;
  rankDisagreement: boolean;
}

/**
 * The deterministic ranker, not the Chief Dispatch Officer, has final say.
 * If the AI recommends a candidate that was never simulated or that the
 * validator disqualified, force the decision to hold_for_operator and fall
 * back to the top valid deterministic rank (if any) for transparency.
 */
function applySafetyOverride(
  aiRecommendation: FinalRecommendation,
  ranking: RankedCandidate[],
  candidates: CandidateOutcome[],
): SafetyOverrideOutcome {
  const chosenRank = ranking.find((entry) => entry.candidateId === aiRecommendation.chosenCandidateId);

  if (!chosenRank || chosenRank.disqualified) {
    const reason = !chosenRank
      ? `Recommended candidateId "${aiRecommendation.chosenCandidateId}" was never simulated or ranked.`
      : `Recommended candidate "${aiRecommendation.chosenCandidateId}" failed deterministic validation: ${chosenRank.disqualifyReason ?? "unspecified violation"}.`;

    const fallback = ranking.find((entry) => !entry.disqualified);
    if (!fallback) {
      return {
        effectiveRecommendation: {
          ...aiRecommendation,
          recommendedAction: "hold_for_operator",
          reasoning: `${reason} No candidate passed deterministic validation for this scenario; every candidate requires operator review.`,
        },
        overridden: true,
        overrideReason: reason,
        rankDisagreement: false,
      };
    }

    const fallbackPlan = candidates.find((candidate) => candidate.candidateId === fallback.candidateId);
    return {
      effectiveRecommendation: {
        ...aiRecommendation,
        chosenCandidateId: fallback.candidateId,
        headline: `Deterministic override: ${fallback.candidateId}`,
        reasoning: `${reason} Falling back to the top deterministically-ranked valid candidate ("${fallback.candidateId}"${fallbackPlan ? `, strategy: ${fallbackPlan.plan.strategy}` : ""}) pending operator review.`,
        recommendedAction: "hold_for_operator",
      },
      overridden: true,
      overrideReason: reason,
      rankDisagreement: false,
    };
  }

  return {
    effectiveRecommendation: aiRecommendation,
    overridden: false,
    overrideReason: null,
    rankDisagreement: chosenRank.rank !== 1,
  };
}

/**
 * Runs the full GridTwin multi-agent pipeline for one asset/scenario pair:
 * parallel market + renewable analysis, dispatch candidate generation, risk
 * review (validate/simulate/stress-test/rank every candidate), and a final
 * Chief Dispatch Officer recommendation. The deterministic simulator and
 * candidate ranker are re-run locally as a safety net for any candidate the
 * agents forget to evaluate, and the final recommendation is never trusted
 * over a hard validation failure (see applySafetyOverride).
 */
export async function runGridTwinOrchestration(input: RunOrchestrationInput): Promise<GridRunResult> {
  const adapter = input.adapter ?? getBackboardAdapter();
  const emit = input.onEvent ?? (() => {});
  const runId = generateRunId();

  const asset = requireAsset(input.assetId);
  const scenario = requireScenario(input.scenarioId);
  const conditions = resolveScenarioConditions(input.scenarioId, asset);
  const context = createRunContext(input.assetId, input.scenarioId, adapter);

  emit({ type: "run.created", runId, assetId: input.assetId, scenarioId: input.scenarioId });

  try {
    const [marketOutcome, renewableOutcome] = await Promise.all([
      runAnalyst({ adapter, context, role: "market-analyst", asset, scenario, runId, emit }),
      runAnalyst({ adapter, context, role: "renewable-analyst", asset, scenario, runId, emit }),
    ]);

    const plannerResolved = await resolveAssistant("dispatch-planner", adapter);
    emit({ type: "agent.started", runId, role: "dispatch-planner", name: plannerResolved.role.name });
    const plannerSchema = buildDispatchCandidatesSchema({
      assetId: input.assetId,
      scenarioId: input.scenarioId,
      intervalMinutes: conditions.intervalMinutes,
      expectedTimestamps: conditions.visibleHours.map((hour) => hour.timestamp),
    });
    const plannerTurn = await runStructuredTurn({
      adapter,
      assistantId: plannerResolved.record.assistantId,
      content: buildDispatchPlannerPrompt({
        asset,
        scenario,
        visibleHours: conditions.visibleHours,
        marketFinding: marketOutcome.finding,
        renewableFinding: renewableOutcome.finding,
      }),
      systemPrompt: plannerResolved.role.systemPrompt,
      modelName: plannerResolved.model.modelName,
      llmProvider: plannerResolved.model.provider,
      tools: getToolDefinitions(plannerResolved.role.toolNames),
      thinking: plannerResolved.role.thinking,
      memory: plannerResolved.role.memory,
      context,
      schema: plannerSchema,
      onToolCallStart: (call) =>
        emit({ type: "tool.requested", runId, role: "dispatch-planner", toolName: call.name }),
      onToolCallEnd: (outcome) =>
        emit({ type: "tool.completed", runId, role: "dispatch-planner", toolName: outcome.toolName, ok: outcome.ok }),
    });
    emit({
      type: "agent.completed",
      runId,
      role: "dispatch-planner",
      name: plannerResolved.role.name,
      summary: `Proposed ${plannerTurn.value.candidates.length} candidate(s).`,
    });
    for (const candidate of plannerTurn.value.candidates) {
      emit({ type: "candidate.created", runId, candidateId: candidate.candidateId, strategy: candidate.plan.strategy });
    }

    const candidateIds = plannerTurn.value.candidates.map((candidate) => candidate.candidateId);
    const reviewerResolved = await resolveAssistant("risk-reviewer", adapter);
    emit({ type: "agent.started", runId, role: "risk-reviewer", name: reviewerResolved.role.name });
    const reviewerTurn = await runStructuredTurn({
      adapter,
      assistantId: reviewerResolved.record.assistantId,
      content: buildRiskReviewerPrompt({ asset, scenario, candidates: plannerTurn.value.candidates }),
      systemPrompt: reviewerResolved.role.systemPrompt,
      modelName: reviewerResolved.model.modelName,
      llmProvider: reviewerResolved.model.provider,
      tools: getToolDefinitions(reviewerResolved.role.toolNames),
      thinking: reviewerResolved.role.thinking,
      memory: reviewerResolved.role.memory,
      context,
      schema: buildRiskReviewsSchema(candidateIds),
      maxRounds: 12,
      onToolCallStart: (call) => emit({ type: "tool.requested", runId, role: "risk-reviewer", toolName: call.name }),
      onToolCallEnd: (outcome) =>
        emit({ type: "tool.completed", runId, role: "risk-reviewer", toolName: outcome.toolName, ok: outcome.ok }),
    });
    emit({
      type: "agent.completed",
      runId,
      role: "risk-reviewer",
      name: reviewerResolved.role.name,
      summary: `Reviewed ${reviewerTurn.value.reviews.length} candidate(s).`,
    });

    const candidateOutcomes: CandidateOutcome[] = plannerTurn.value.candidates.map(({ candidateId, plan }) => {
      const existing = context.simulationsByCandidateId.get(candidateId) ?? {};

      let visible = existing.visible;
      let simulationSource: EvidenceSource = "agent";
      if (!visible) {
        visible = simulateDispatchPlan(plan, asset, conditions.visibleHours);
        simulationSource = "local_fallback";
      }

      let stress = existing.stress;
      let stressSimulationSource: EvidenceSource = "agent";
      if (!stress) {
        stress = simulateDispatchPlan(plan, asset, conditions.actualHours);
        stressSimulationSource = "local_fallback";
      }

      emit({
        type: "candidate.simulated",
        runId,
        candidateId,
        valid: visible.valid,
        netValueCad: visible.metrics.netValueCad,
        source: simulationSource,
      });
      emit({ type: "candidate.stress_tested", runId, candidateId, valid: stress.valid, source: stressSimulationSource });

      return { candidateId, plan, simulation: visible, simulationSource, stressSimulation: stress, stressSimulationSource };
    });

    const ranking = rankCandidates(
      candidateOutcomes.map((candidate) => ({ candidateId: candidate.candidateId, result: candidate.simulation })),
      input.objectiveWeights,
    );
    emit({ type: "candidates.ranked", runId, ranking });

    const chiefResolved = await resolveAssistant("chief-dispatch-officer", adapter);
    emit({ type: "agent.started", runId, role: "chief-dispatch-officer", name: chiefResolved.role.name });
    const chiefTurn = await runStructuredTurn({
      adapter,
      assistantId: chiefResolved.record.assistantId,
      content: buildChiefPrompt({
        asset,
        scenario,
        marketFinding: marketOutcome.finding,
        renewableFinding: renewableOutcome.finding,
        candidates: candidateOutcomes,
        riskReviews: reviewerTurn.value.reviews,
        ranking,
      }),
      systemPrompt: chiefResolved.role.systemPrompt,
      modelName: chiefResolved.model.modelName,
      llmProvider: chiefResolved.model.provider,
      tools: getToolDefinitions(chiefResolved.role.toolNames),
      thinking: chiefResolved.role.thinking,
      memory: chiefResolved.role.memory,
      context,
      schema: buildFinalRecommendationSchema(candidateIds),
    });

    const { effectiveRecommendation, overridden, overrideReason, rankDisagreement } = applySafetyOverride(
      chiefTurn.value,
      ranking,
      candidateOutcomes,
    );
    emit({
      type: "agent.completed",
      runId,
      role: "chief-dispatch-officer",
      name: chiefResolved.role.name,
      summary: chiefTurn.value.headline,
    });
    emit({
      type: "recommendation.ready",
      runId,
      recommendation: effectiveRecommendation,
      overridden,
      overrideReason: overrideReason ?? undefined,
    });

    const result: GridRunResult = {
      runId,
      assetId: input.assetId,
      scenarioId: input.scenarioId,
      marketFinding: marketOutcome.finding,
      renewableFinding: renewableOutcome.finding,
      candidates: candidateOutcomes,
      riskReviews: reviewerTurn.value.reviews,
      ranking,
      aiRecommendation: chiefTurn.value,
      effectiveRecommendation,
      recommendationOverridden: overridden,
      overrideReason,
      rankDisagreement,
      chiefAssistantId: chiefResolved.record.assistantId,
      chiefThreadId: chiefTurn.result.finalResult.threadId,
      hiddenStressDescription: conditions.hiddenStressDescription,
    };
    emit({ type: "run.completed", runId, result });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit({ type: "run.failed", runId, error: message });
    throw error;
  }
}
