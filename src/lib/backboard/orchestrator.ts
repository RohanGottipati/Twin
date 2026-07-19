import { z } from "zod";

import { getBackboardAdapter } from "@/lib/backboard/adapter";
import { resolveAssistant } from "@/lib/backboard/assistant-manifest";
import { selectAssistantBundle, type AssistantRoleKey } from "@/lib/backboard/assistants";
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
import type { CohortModeShare, TransitCohortFixture } from "@/data/transit/cohorts";
import { listStressOverlays, requireScenario } from "@/data/transit/scenarios";
import { getCitizenReactionProvider } from "@/lib/citizen-reaction/provider";
import type { CitizenCohort, CitizenReactionBatchResult, CitizenReactionContext } from "@/lib/citizen-reaction/schemas";
import { rankInterventions, type RankableIntervention } from "@/lib/transit/candidate-ranker";
import { getTransitRepository } from "@/lib/transit/repository";
import { simulateTransit } from "@/lib/transit/simulator";
import { stressTestIntervention, type StressTestOutcome } from "@/lib/transit/stress-tests";
import {
  finalPolicyRecommendationSchema,
  transitAnalystFindingSchema,
  transitInterventionSchema,
  type FinalPolicyRecommendation,
  type PolicyCandidate,
  type TransitAnalystFinding,
  type TransitScenario,
  type TransitSimulationResult,
  type TransitIntervention,
} from "@/lib/transit/schemas";

export class OrchestrationError extends Error {}

export type EvidenceSource = "agent" | "local_fallback";

/** The TechTO agent-role key. Identical to AssistantRoleKey; kept as a named alias so orchestration code reads in domain terms. */
export type TechTOAgentRole = AssistantRoleKey;

export interface TechTOIntervention {
  id: string;
  title: string;
  description: string;
  category: string;
}

/**
 * Frontend-safe lifecycle stream for one TechTO planner-agent run: problem
 * framing -> baseline -> parallel context gathering -> policy generation ->
 * citizen reaction -> simulation -> parallel impact review -> stress test ->
 * debate -> final judgment, mirrored by generic agent/tool events. Coarse by
 * design (AGENTS.md "keep the scored thing legible"): never carries raw
 * reasoning/thinking content, only lifecycle markers and domain evidence.
 */
export type TechTORunEvent =
  | { type: "run.started"; runId: string; scenarioId: string }
  | { type: "problem.started"; runId: string }
  | { type: "problem.completed"; runId: string; summary: string }
  | { type: "baseline.started"; runId: string }
  | { type: "baseline.completed"; runId: string; summary: string }
  | { type: "context.started"; runId: string }
  | { type: "context.completed"; runId: string; summary: string }
  | { type: "policy.generated"; runId: string; intervention: TransitIntervention }
  | { type: "citizens.started"; runId: string }
  | { type: "citizens.completed"; runId: string; candidateId: string; result: CitizenReactionBatchResult }
  | { type: "simulation.started"; runId: string }
  | { type: "simulation.completed"; runId: string; candidateId: string; summary: string }
  | { type: "impact.started"; runId: string }
  | { type: "impact.completed"; runId: string; summary: string }
  | { type: "stress.started"; runId: string }
  | { type: "stress.completed"; runId: string; candidateId: string; summary: string; invalidated: boolean }
  | { type: "debate.started"; runId: string }
  | { type: "debate.completed"; runId: string; summary: string }
  | {
      type: "recommendation.ready";
      runId: string;
      recommendation: FinalPolicyRecommendation;
      overridden: boolean;
      overrideReason?: string;
    }
  | { type: "operator.ready"; runId: string; question: string }
  | { type: "run.completed"; runId: string; result: TechTORunResult }
  | { type: "run.failed"; runId: string; error: string }
  | { type: "agent.started"; runId: string; role: TechTOAgentRole; name: string }
  | { type: "agent.completed"; runId: string; role: TechTOAgentRole; name: string; summary: string }
  | { type: "agent.failed"; runId: string; role: TechTOAgentRole; name: string; error: string }
  | { type: "tool.requested"; runId: string; role: TechTOAgentRole; toolName: string }
  | { type: "tool.completed"; runId: string; role: TechTOAgentRole; toolName: string; ok: boolean };

export interface CandidateEvaluation {
  candidateId: string;
  intervention: TransitIntervention;
  simulation: TransitSimulationResult;
  simulationSource: EvidenceSource;
  stress: StressTestOutcome | null;
  stressSource: EvidenceSource;
  citizenReactions: CitizenReactionBatchResult | null;
  citizenReactionsSource: EvidenceSource;
}

export interface TechTORunResult {
  runId: string;
  scenarioId: string;
  problemSummary: string;
  baselineSummary: string;
  candidates: TransitIntervention[];
  simulations: { candidateId: string; result: TransitSimulationResult }[];
  stressResults: { candidateId: string; result: StressTestOutcome }[];
  citizenReactions: { candidateId: string; result: CitizenReactionBatchResult }[];
  ranking: PolicyCandidate[];
  /** Verbatim structured output from the Final Policy Judge, kept for audit even when overridden. */
  aiRecommendation: FinalPolicyRecommendation;
  /** What the UI should actually act on: identical to aiRecommendation unless a hard final-authority override fired. */
  effectiveRecommendation: FinalPolicyRecommendation;
  recommendationOverridden: boolean;
  overrideReason: string | null;
  judgeAssistantId: string;
  judgeThreadId: string;
  /** Every assistant role that actually took part in this run, in invocation order (deduplicated). */
  participatingAgents: TechTOAgentRole[];
}

export interface RunOrchestrationInput {
  scenarioId: string;
  includeWebSearch?: boolean;
  adapter?: BackboardAdapter;
  onEvent?: (event: TechTORunEvent) => void;
}

function generateRunId(): string {
  return `run-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

function formatZodError(error: z.ZodError): string {
  return error.issues.map((issue) => `- ${issue.path.join(".") || "(root)"}: ${issue.message}`).join("\n");
}

// ---------------------------------------------------------------------------
// Generic structured-turn helper (same retry-on-malformed-JSON pattern used
// throughout Backboard orchestration; see AGENTS.md 3.3 on legible output).
// ---------------------------------------------------------------------------

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
 * retries up to `maxRetries` times before giving up. `maxRounds` (tool-call
 * round trips) defaults to runToolLoop's own default (8).
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

// ---------------------------------------------------------------------------
// Finding agents: the many specialist roles that narrate a
// transitAnalystFindingSchema-shaped observation, grounded in their own tool
// calls. Resilient by design: a failed or malformed turn never aborts the
// run, it degrades to a low-confidence local fallback finding so the
// pipeline can always finish (AGENTS.md: the simulator, not the narrator, is
// the authority).
// ---------------------------------------------------------------------------

interface FindingAgentParams {
  adapter: BackboardAdapter;
  context: RunContext;
  role: AssistantRoleKey;
  runId: string;
  prompt: string;
  emit: (event: TechTORunEvent) => void;
  maxRounds?: number;
  fallbackSummary: string;
}

interface FindingAgentOutcome {
  role: AssistantRoleKey;
  name: string;
  finding: TransitAnalystFinding;
  threadId: string | null;
  assistantId: string;
  source: EvidenceSource;
}

function findingResponseInstruction(): string {
  return `Respond with ONLY JSON matching:\n{"role": string, "headline": string, "summary": string, "keySignals": string[], "confidence": number between 0 and 1}\nDo not include any prose outside the JSON.`;
}

function scenarioContextBlock(scenario: TransitScenario): string {
  return [
    `Scenario: ${scenario.id} - ${scenario.label}.`,
    scenario.description ?? "",
    `Station: ${scenario.stationId}. Route: ${scenario.routeId}. Window: ${scenario.window.start} to ${scenario.window.end}.`,
    `Baseline departures: ${scenario.baselineDepartures.join(", ")}.`,
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

async function runFindingAgent(params: FindingAgentParams): Promise<FindingAgentOutcome> {
  const resolved = await resolveAssistant(params.role, params.adapter);
  params.emit({ type: "agent.started", runId: params.runId, role: params.role, name: resolved.role.name });

  try {
    const turn = await runStructuredTurn({
      adapter: params.adapter,
      assistantId: resolved.record.assistantId,
      content: params.prompt,
      systemPrompt: resolved.role.systemPrompt,
      modelName: resolved.model.modelName,
      llmProvider: resolved.model.provider,
      tools: getToolDefinitions(resolved.role.toolNames),
      thinking: resolved.role.thinking,
      memory: resolved.role.memory,
      context: params.context,
      schema: transitAnalystFindingSchema,
      maxRounds: params.maxRounds,
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
    return {
      role: params.role,
      name: resolved.role.name,
      finding: turn.value,
      threadId: turn.result.finalResult.threadId,
      assistantId: resolved.record.assistantId,
      source: "agent",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    params.emit({ type: "agent.failed", runId: params.runId, role: params.role, name: resolved.role.name, error: message });

    const fallback = transitAnalystFindingSchema.parse({
      role: params.role,
      headline: `${resolved.role.name}: evidence unavailable`,
      summary: params.fallbackSummary,
      keySignals: [],
      confidence: 0.2,
    });
    params.emit({
      type: "agent.completed",
      runId: params.runId,
      role: params.role,
      name: resolved.role.name,
      summary: fallback.headline,
    });
    return {
      role: params.role,
      name: resolved.role.name,
      finding: fallback,
      threadId: null,
      assistantId: resolved.record.assistantId,
      source: "local_fallback",
    };
  }
}

// ---------------------------------------------------------------------------
// Citizen cohort mapping (transit cohort fixtures -> citizen-reaction contract)
// ---------------------------------------------------------------------------

function mapAgeBand(ageBand: string): "youth" | "adult" | "senior" {
  if (ageBand.includes("65") || ageBand.includes("+")) return "senior";
  if (ageBand.startsWith("18")) return "youth";
  return "adult";
}

function dominantMode(shares: CohortModeShare): "transit" | "car" | "walk" | "bike" {
  const entries: [("transit" | "car" | "walk" | "bike"), number][] = [
    ["transit", shares.transit],
    ["car", shares.car],
    ["walk", shares.walk],
    ["bike", shares.cycle],
  ];
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

function buildCitizenCohorts(cohorts: TransitCohortFixture[]): CitizenCohort[] {
  return cohorts.map((cohort) => ({
    cohortId: cohort.id,
    label: cohort.label,
    populationWeight: cohort.weight,
    homeNeighborhood: cohort.homeZoneId,
    demographics: {
      ageBand: mapAgeBand(cohort.ageBand),
      incomeBand: cohort.incomeBand,
      primaryMode: dominantMode(cohort.baselineModeShare),
      hasDisability: cohort.mobilityNeeds.length > 0,
    },
  }));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function buildCitizenReactionContext(
  baseline: TransitSimulationResult,
  candidate: TransitSimulationResult,
): CitizenReactionContext {
  return {
    wait: { beforeMinutes: baseline.metrics.meanWaitMinutes, afterMinutes: candidate.metrics.meanWaitMinutes },
    crowding: {
      beforeIndex: clamp01(baseline.metrics.loadImbalance),
      afterIndex: clamp01(candidate.metrics.loadImbalance),
    },
    transfer: { beforeCount: baseline.metrics.missedTransfers, afterCount: candidate.metrics.missedTransfers },
    accessibility: {
      beforeScore: baseline.metrics.accessibilityFailures > 0 ? 0 : 1,
      afterScore: candidate.metrics.accessibilityFailures > 0 ? 0 : 1,
    },
  };
}

// ---------------------------------------------------------------------------
// Policy candidate generation (with a deterministic fallback so a run never
// stalls with zero candidates).
// ---------------------------------------------------------------------------

const policyCandidatesSchema = z
  .object({ candidates: z.array(transitInterventionSchema).min(1).max(3) })
  .strict()
  .refine((data) => new Set(data.candidates.map((candidate) => candidate.id)).size === data.candidates.length, {
    message: "candidate ids must be unique across candidates.",
    path: ["candidates"],
  });

function buildPolicyPrompt(params: {
  scenario: TransitScenario;
  problem: TransitAnalystFinding;
  baseline: TransitAnalystFinding;
  contextFindings: TransitAnalystFinding[];
}): string {
  return `
${scenarioContextBlock(params.scenario)}

Problem Definition finding:
${JSON.stringify(params.problem)}

Baseline Analyst finding:
${JSON.stringify(params.baseline)}

Context findings:
${JSON.stringify(params.contextFindings)}

Call find_similar_interventions for precedent, and get_fleet_availability for routeId "${params.scenario.routeId}" before
proposing anything that adds a trip or capacity.

Propose 2-3 candidate schedule interventions that explore genuinely different strategies (for example: a
retiming-only plan, a capacity-boost plan, and a combined plan), not minor variations of the same idea. Give every
candidate a short, unique, memorable id.

Respond with ONLY JSON matching:
{"candidates": [{"id": string, "label": string, "description"?: string, "actions": [{"type": "shift_departure_minutes"|"add_trip"|"capacity_boost"|"entrance_closure"|"hold_departure"|"retime_feeder", ...}]}]}
`.trim();
}

function synthesizeFallbackCandidates(scenario: TransitScenario): TransitIntervention[] {
  const firstDeparture = scenario.baselineDepartures[0];
  const candidates: unknown[] = [
    {
      id: "fallback-retime",
      label: "Fallback: retime first departure",
      description: "Deterministic fallback candidate: shift the first scheduled departure later by 2 minutes.",
      actions: [{ type: "shift_departure_minutes", departureId: firstDeparture, deltaMinutes: 2 }],
    },
    {
      id: "fallback-capacity-boost",
      label: "Fallback: add capacity to first departure",
      description: "Deterministic fallback candidate: add extra capacity to the first scheduled departure.",
      actions: [
        {
          type: "capacity_boost",
          departureId: firstDeparture,
          extraCapacity: Math.max(10, Math.round(scenario.vehicleCapacity * 0.2)),
        },
      ],
    },
  ];
  return candidates.map((candidate) => transitInterventionSchema.parse(candidate));
}

// ---------------------------------------------------------------------------
// Final authority: hard failure checks no recommendation can override.
// ---------------------------------------------------------------------------

function hardFailureReasons(evaluation: CandidateEvaluation, stressOverlayAvailable: boolean): string[] {
  const reasons: string[] = [];

  for (const violation of evaluation.simulation.violations) {
    if (violation.severity === "error") {
      reasons.push(`validation error (${violation.code}): ${violation.message}`);
    }
  }
  if (evaluation.simulation.violations.some((violation) => violation.code === "platform-crowding-exceeded")) {
    reasons.push("unsafe platform crowding under visible conditions");
  }
  if (evaluation.simulation.metrics.accessibilityFailures > 0) {
    reasons.push(`inaccessible policy: ${evaluation.simulation.metrics.accessibilityFailures} accessibility failure(s)`);
  }
  if (evaluation.stress?.invalidated) {
    reasons.push(
      `fails under stress test: ${evaluation.stress.invalidationReasons.join("; ") || "invalidated under stress"}`,
    );
  }
  if (stressOverlayAvailable && !evaluation.stress) {
    reasons.push("missing stress-test evidence");
  }
  if (!evaluation.citizenReactions) {
    reasons.push("missing citizen-reaction evidence");
  }

  return Array.from(new Set(reasons));
}

interface FinalAuthorityOutcome {
  effectiveRecommendation: FinalPolicyRecommendation;
  overridden: boolean;
  overrideReason: string | null;
}

/**
 * The deterministic simulator and stress tester, not the Final Policy
 * Judge, have final say (AGENTS.md 3.2: the scorer is never co-adapted with
 * the generator). If the judge recommends a candidate with any hard
 * safety/accessibility/evidence failure, force the decision to
 * hold_for_operator and fall back to the best clean candidate (if any) for
 * transparency.
 */
function applyFinalAuthority(params: {
  evaluations: CandidateEvaluation[];
  ranking: PolicyCandidate[];
  chosen: FinalPolicyRecommendation;
  stressOverlayAvailable: boolean;
}): FinalAuthorityOutcome {
  const { evaluations, ranking, chosen, stressOverlayAvailable } = params;
  const evaluationById = new Map(evaluations.map((evaluation) => [evaluation.candidateId, evaluation]));
  const rankById = new Map(ranking.map((entry) => [entry.interventionId, entry]));

  const failuresFor = (candidateId: string): string[] => {
    const evaluation = evaluationById.get(candidateId);
    if (!evaluation) return ["was never simulated or evaluated in this run"];
    const reasons = hardFailureReasons(evaluation, stressOverlayAvailable);
    const rank = rankById.get(candidateId);
    if (rank?.disqualified) reasons.push(rank.disqualifyReason ?? "failed deterministic validation");
    return Array.from(new Set(reasons));
  };

  const chosenFailures = failuresFor(chosen.chosenCandidateId);
  if (chosenFailures.length === 0) {
    return { effectiveRecommendation: chosen, overridden: false, overrideReason: null };
  }

  const reason = `Recommended candidate "${chosen.chosenCandidateId}" failed final-authority checks: ${chosenFailures.join("; ")}.`;

  const cleanFallback = [...ranking]
    .filter((entry) => !entry.disqualified)
    .sort((a, b) => a.rank - b.rank)
    .find((entry) => failuresFor(entry.interventionId).length === 0);

  if (!cleanFallback) {
    return {
      effectiveRecommendation: {
        ...chosen,
        recommendedAction: "hold_for_operator",
        reasoning: `${reason} No candidate in this run passed every hard safety, accessibility, and evidence check; every candidate requires operator review.`,
      },
      overridden: true,
      overrideReason: reason,
    };
  }

  return {
    effectiveRecommendation: {
      ...chosen,
      chosenCandidateId: cleanFallback.interventionId,
      headline: `Deterministic override: ${cleanFallback.interventionId}`,
      reasoning: `${reason} Falling back to the top deterministically-ranked candidate that passes every hard check ("${cleanFallback.interventionId}") pending operator review.`,
      recommendedAction: "hold_for_operator",
    },
    overridden: true,
    overrideReason: reason,
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runTechTOOrchestration(input: RunOrchestrationInput): Promise<TechTORunResult> {
  const adapter = input.adapter ?? getBackboardAdapter();
  const emit = input.onEvent ?? (() => {});
  const runId = generateRunId();
  const participatingAgents: AssistantRoleKey[] = [];
  const seenAgents = new Set<AssistantRoleKey>();
  const recordParticipant = (role: AssistantRoleKey) => {
    if (!seenAgents.has(role)) {
      seenAgents.add(role);
      participatingAgents.push(role);
    }
  };

  const scenario = requireScenario(input.scenarioId);
  const repo = await getTransitRepository();
  const context = createRunContext(input.scenarioId, adapter, undefined, runId);
  const declaredBundle = selectAssistantBundle(input.scenarioId);
  const includesConcertBundle = input.scenarioId === "departure-406-412";
  void declaredBundle;

  emit({ type: "run.started", runId, scenarioId: input.scenarioId });

  try {
    const baselineSimulation = simulateTransit({
      schemaVersion: 1,
      scenario,
      intervention: null,
      stressOverlay: null,
      seed: 20260718,
      cohorts: repo.listCohorts(),
    });

    // -- Problem definition --------------------------------------------------
    emit({ type: "problem.started", runId });
    const problemOutcome = await runFindingAgent({
      adapter,
      context,
      role: "planning-orchestrator",
      runId,
      emit,
      prompt: `${scenarioContextBlock(scenario)}\n\nCall your tools to read the network snapshot, this scenario's passenger arrivals, and any active event context. Write a precise, falsifiable statement of what is going wrong: which departure, which station, which window, what fails and by how much.\n\n${findingResponseInstruction()}`,
      fallbackSummary: `Baseline simulation shows a mean wait of ${baselineSimulation.metrics.meanWaitMinutes.toFixed(1)} minutes and ${baselineSimulation.metrics.deniedBoardings} denied boarding(s) at ${scenario.stationId}.`,
    });
    recordParticipant(problemOutcome.role);
    emit({ type: "problem.completed", runId, summary: problemOutcome.finding.summary });

    // -- Baseline analysis ----------------------------------------------------
    emit({ type: "baseline.started", runId });
    const baselineOutcome = await runFindingAgent({
      adapter,
      context,
      role: "evidence-auditor",
      runId,
      emit,
      prompt: `${scenarioContextBlock(scenario)}\n\nCall get_route_schedule (routeId "${scenario.routeId}"), get_departure_loads (no interventionId), and get_passenger_arrivals to establish the no-intervention baseline. Report the baseline numbers plainly.\n\n${findingResponseInstruction()}`,
      fallbackSummary: `Deterministic baseline: meanWaitMinutes=${baselineSimulation.metrics.meanWaitMinutes.toFixed(2)}, deniedBoardings=${baselineSimulation.metrics.deniedBoardings}, loadImbalance=${baselineSimulation.metrics.loadImbalance.toFixed(3)}.`,
    });
    recordParticipant(baselineOutcome.role);
    emit({ type: "baseline.completed", runId, summary: baselineOutcome.finding.summary });

    // -- Parallel context gathering -------------------------------------------
    emit({ type: "context.started", runId });
    const contextRoles: AssistantRoleKey[] = [
      "geospatial-twin",
      "scenario-designer",
      "feasibility",
      "equity-impact",
    ];
    const contextOutcomes = await Promise.all(
      contextRoles.map((role) =>
        runFindingAgent({
          adapter,
          context,
          role,
          runId,
          emit,
          prompt: `${scenarioContextBlock(scenario)}\n\nCall your tools for this scenario and report your findings.\n\n${findingResponseInstruction()}`,
          fallbackSummary: `Evidence for role "${role}" was unavailable this run; deterministic tool data remains the source of truth.`,
        }),
      ),
    );
    for (const outcome of contextOutcomes) recordParticipant(outcome.role);
    emit({
      type: "context.completed",
      runId,
      summary: contextOutcomes.map((outcome) => outcome.finding.headline).join(" | "),
    });

    // -- Policy candidate generation -------------------------------------------
    const policyResolved = await resolveAssistant("scenario-designer", adapter);
    emit({ type: "agent.started", runId, role: "scenario-designer", name: policyResolved.role.name });
    let candidates: TransitIntervention[];
    try {
      const policyTurn = await runStructuredTurn({
        adapter,
        assistantId: policyResolved.record.assistantId,
        content: buildPolicyPrompt({
          scenario,
          problem: problemOutcome.finding,
          baseline: baselineOutcome.finding,
          contextFindings: contextOutcomes.map((outcome) => outcome.finding),
        }),
        systemPrompt: policyResolved.role.systemPrompt,
        modelName: policyResolved.model.modelName,
        llmProvider: policyResolved.model.provider,
        tools: getToolDefinitions(policyResolved.role.toolNames),
        thinking: policyResolved.role.thinking,
        memory: policyResolved.role.memory,
        context,
        schema: policyCandidatesSchema,
        onToolCallStart: (call) =>
          emit({ type: "tool.requested", runId, role: "scenario-designer", toolName: call.name }),
        onToolCallEnd: (outcome) =>
          emit({
            type: "tool.completed",
            runId,
            role: "scenario-designer",
            toolName: outcome.toolName,
            ok: outcome.ok,
          }),
      });
      candidates = policyTurn.value.candidates;
      emit({
        type: "agent.completed",
        runId,
        role: "scenario-designer",
        name: policyResolved.role.name,
        summary: `Proposed ${candidates.length} candidate(s).`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emit({ type: "agent.failed", runId, role: "scenario-designer", name: policyResolved.role.name, error: message });
      candidates = synthesizeFallbackCandidates(scenario);
      emit({
        type: "agent.completed",
        runId,
        role: "scenario-designer",
        name: policyResolved.role.name,
        summary: `Fell back to ${candidates.length} deterministic candidate(s) after a structured-output failure.`,
      });
    }
    recordParticipant("scenario-designer");
    for (const candidate of candidates) {
      const state = context.simulationsByCandidateId.get(candidate.id) ?? { intervention: candidate };
      state.intervention = candidate;
      context.simulationsByCandidateId.set(candidate.id, state);
      emit({ type: "policy.generated", runId, intervention: candidate });
    }

    // -- Simulation (deterministic authority; agent turns add narration) -----
    emit({ type: "simulation.started", runId });
    const simulationNarrationOutcomes = await Promise.all(
      (["scenario-designer", "adversarial-reviewer"] as AssistantRoleKey[]).map((role) =>
        runFindingAgent({
          adapter,
          context,
          role,
          runId,
          emit,
          prompt: `${scenarioContextBlock(scenario)}\n\nCandidates under review:\n${JSON.stringify(candidates)}\n\nCall run_transit_simulation for each candidate above (using its exact JSON), then report your findings.\n\n${findingResponseInstruction()}`,
          fallbackSummary: `Deterministic simulation is the source of truth for these ${candidates.length} candidate(s); narration from role "${role}" was unavailable this run.`,
        }),
      ),
    );
    for (const outcome of simulationNarrationOutcomes) recordParticipant(outcome.role);

    const evaluations: CandidateEvaluation[] = candidates.map((candidate) => {
      const state = context.simulationsByCandidateId.get(candidate.id);
      let simulation = state?.visible;
      let simulationSource: EvidenceSource = "agent";
      if (!simulation) {
        simulation = simulateTransit({
          schemaVersion: 1,
          scenario,
          intervention: candidate,
          stressOverlay: null,
          seed: 20260718,
          cohorts: repo.listCohorts(),
        });
        simulationSource = "local_fallback";
        const nextState = state ?? { intervention: candidate };
        nextState.visible = simulation;
        nextState.intervention = candidate;
        context.simulationsByCandidateId.set(candidate.id, nextState);
      }
      emit({
        type: "simulation.completed",
        runId,
        candidateId: candidate.id,
        summary: `meanWaitMinutes=${simulation.metrics.meanWaitMinutes.toFixed(2)}, deniedBoardings=${simulation.metrics.deniedBoardings}, valid=${simulation.valid}`,
      });
      return {
        candidateId: candidate.id,
        intervention: candidate,
        simulation,
        simulationSource,
        stress: null,
        stressSource: "local_fallback" as EvidenceSource,
        citizenReactions: null,
        citizenReactionsSource: "local_fallback" as EvidenceSource,
      };
    });

    const ranking = rankInterventions(
      evaluations.map((evaluation): RankableIntervention => ({ intervention: evaluation.intervention, result: evaluation.simulation })),
    );

    // -- Citizen reaction ------------------------------------------------------
    emit({ type: "citizens.started", runId });
    const cohorts = buildCitizenCohorts(repo.listCohorts());
    const citizenResponseSchema = z
      .object({ summary: z.string().min(1).max(1500), processedCandidateIds: z.array(z.string()).default([]) })
      .strict();
    const citizenPrompt = `
${scenarioContextBlock(scenario)}

Candidates and their deterministic before/after effect features (baseline vs candidate simulation):
${JSON.stringify(
  evaluations.map((evaluation) => ({
    intervention: { id: evaluation.intervention.id, title: evaluation.intervention.label, description: evaluation.intervention.description ?? evaluation.intervention.label },
    context: buildCitizenReactionContext(baselineSimulation, evaluation.simulation),
  })),
)}

Cohorts to react on behalf of (${cohorts.length} census-weighted cohorts):
${JSON.stringify(cohorts)}

For EACH candidate above, call call_citizen_reaction_model with that candidate's intervention, the cohorts, and its
context, then call aggregate_citizen_reactions with the exact reactions it returned. Every reaction is a SIMULATED
reading, never real public opinion.

Respond with ONLY JSON matching:
{"summary": string, "processedCandidateIds": string[]}
`.trim();

    const citizenRoles: AssistantRoleKey[] = ["citizen-response", "equity-impact"];
    const [citizenCoordinatorOutcome, ...citizenAuxOutcomes] = await Promise.all([
      (async () => {
        const resolved = await resolveAssistant("citizen-response", adapter);
        emit({ type: "agent.started", runId, role: "citizen-response", name: resolved.role.name });
        try {
          const turn = await runStructuredTurn({
            adapter,
            assistantId: resolved.record.assistantId,
            content: citizenPrompt,
            systemPrompt: resolved.role.systemPrompt,
            modelName: resolved.model.modelName,
            llmProvider: resolved.model.provider,
            tools: getToolDefinitions(resolved.role.toolNames),
            thinking: resolved.role.thinking,
            memory: resolved.role.memory,
            context,
            schema: citizenResponseSchema,
            maxRounds: 10,
            onToolCallStart: (call) => emit({ type: "tool.requested", runId, role: "citizen-response", toolName: call.name }),
            onToolCallEnd: (outcome) =>
              emit({ type: "tool.completed", runId, role: "citizen-response", toolName: outcome.toolName, ok: outcome.ok }),
          });
          emit({ type: "agent.completed", runId, role: "citizen-response", name: resolved.role.name, summary: turn.value.summary });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          emit({ type: "agent.failed", runId, role: "citizen-response", name: resolved.role.name, error: message });
          emit({
            type: "agent.completed",
            runId,
            role: "citizen-response",
            name: resolved.role.name,
            summary: "Citizen reactions computed via local deterministic fallback.",
          });
        }
      })(),
      ...citizenRoles
        .filter((role) => role !== "citizen-response")
        .map((role) =>
          runFindingAgent({
            adapter,
            context,
            role,
            runId,
            emit,
            prompt: `${scenarioContextBlock(scenario)}\n\nCandidates under review:\n${JSON.stringify(candidates)}\n\nCall your tools for this scenario and report your findings.\n\n${findingResponseInstruction()}`,
            fallbackSummary: `Evidence for role "${role}" was unavailable this run.`,
          }),
        ),
    ]);
    void citizenCoordinatorOutcome;
    recordParticipant("citizen-response");
    for (const outcome of citizenAuxOutcomes) recordParticipant(outcome.role);

    const citizenProvider = getCitizenReactionProvider();
    for (const evaluation of evaluations) {
      const state = context.simulationsByCandidateId.get(evaluation.candidateId);
      let reactions = state?.citizenReactions;
      let source: EvidenceSource = "agent";
      if (!reactions) {
        reactions = await citizenProvider.predictBatch({
          scenarioId: input.scenarioId,
          intervention: {
            id: evaluation.intervention.id,
            title: evaluation.intervention.label,
            description: evaluation.intervention.description ?? evaluation.intervention.label,
            category: "transit",
          },
          cohorts,
          context: buildCitizenReactionContext(baselineSimulation, evaluation.simulation),
        });
        source = "local_fallback";
        const nextState = state ?? { intervention: evaluation.intervention };
        nextState.citizenReactions = reactions;
        context.simulationsByCandidateId.set(evaluation.candidateId, nextState);
      }
      evaluation.citizenReactions = reactions;
      evaluation.citizenReactionsSource = source;
      emit({ type: "citizens.completed", runId, candidateId: evaluation.candidateId, result: reactions });
    }

    // -- Parallel impact review -------------------------------------------------
    emit({ type: "impact.started", runId });
    const topCandidateId =
      ranking.find((entry) => !entry.disqualified)?.interventionId ?? ranking[0]?.interventionId ?? evaluations[0]?.candidateId;
    const topEvaluation = evaluations.find((evaluation) => evaluation.candidateId === topCandidateId) ?? evaluations[0];
    const impactRoles: AssistantRoleKey[] = [
      "feasibility",
      "equity-impact",
      "citizen-response",
    ];
    const impactOutcomes = await Promise.all(
      impactRoles.map((role) =>
        runFindingAgent({
          adapter,
          context,
          role,
          runId,
          emit,
          prompt: `${scenarioContextBlock(scenario)}\n\nLeading candidate under review:\n${JSON.stringify(topEvaluation?.intervention)}\n\nCall your tools for this scenario and candidate and report your findings.\n\n${findingResponseInstruction()}`,
          fallbackSummary: `Deterministic metrics for candidate "${topCandidateId}": ${JSON.stringify(topEvaluation?.simulation.metrics)}`,
        }),
      ),
    );
    for (const outcome of impactOutcomes) recordParticipant(outcome.role);
    emit({ type: "impact.completed", runId, summary: impactOutcomes.map((outcome) => outcome.finding.headline).join(" | ") });

    // -- Stress testing ----------------------------------------------------------
    emit({ type: "stress.started", runId });
    const stressOverlay = listStressOverlays()[0] ?? null;
    const stressOverlayAvailable = stressOverlay !== null;

    if (stressOverlay) {
      for (const evaluation of evaluations) {
        const state = context.simulationsByCandidateId.get(evaluation.candidateId);
        let outcome = state?.stress;
        let source: EvidenceSource = "agent";
        if (!outcome) {
          outcome = stressTestIntervention(scenario, evaluation.intervention, stressOverlay, 20260718, repo.listCohorts());
          source = "local_fallback";
          const nextState = state ?? { intervention: evaluation.intervention };
          nextState.stress = outcome;
          context.simulationsByCandidateId.set(evaluation.candidateId, nextState);
        }
        evaluation.stress = outcome;
        evaluation.stressSource = source;
        emit({
          type: "stress.completed",
          runId,
          candidateId: evaluation.candidateId,
          summary: outcome.invalidated
            ? `Invalidated under stress: ${outcome.invalidationReasons.join("; ") || "fails once stressed"}`
            : "Remains valid under the hidden stress overlay.",
          invalidated: outcome.invalidated,
        });
      }
    }

    const stressAgentRoles: AssistantRoleKey[] = includesConcertBundle
      ? ["adversarial-reviewer", "evidence-auditor", "feasibility"]
      : ["adversarial-reviewer", "evidence-auditor"];
    const stressOutcomes = await Promise.all(
      stressAgentRoles.map((role) =>
        runFindingAgent({
          adapter,
          context,
          role,
          runId,
          emit,
          prompt: `${scenarioContextBlock(scenario)}\n\nCandidates and their deterministic simulation/stress results:\n${JSON.stringify(
            evaluations.map((evaluation) => ({
              candidateId: evaluation.candidateId,
              metrics: evaluation.simulation.metrics,
              stressInvalidated: evaluation.stress?.invalidated ?? null,
            })),
          )}\n\nCall your tools for this scenario and report your findings, thinking adversarially about worst-case combinations.\n\n${findingResponseInstruction()}`,
          fallbackSummary: `Deterministic stress-test authority stands: ${
            evaluations.filter((evaluation) => evaluation.stress?.invalidated).length
          } of ${evaluations.length} candidate(s) invalidated under stress.`,
        }),
      ),
    );
    for (const outcome of stressOutcomes) recordParticipant(outcome.role);

    // -- Policy debate -------------------------------------------------------------
    emit({ type: "debate.started", runId });
    const debateSchema = z
      .object({ summary: z.string().min(1).max(2000), disagreements: z.array(z.string().max(300)).max(10).default([]) })
      .strict();
    const debateResolved = await resolveAssistant("final-policy-judge", adapter);
    emit({ type: "agent.started", runId, role: "final-policy-judge", name: debateResolved.role.name });
    let debateSummary: string;
    try {
      const debateTurn = await runStructuredTurn({
        adapter,
        assistantId: debateResolved.record.assistantId,
        content: `${scenarioContextBlock(scenario)}\n\nDeterministic ranking (rank 1 = best; disqualified candidates failed hard validation):\n${JSON.stringify(ranking)}\n\nCall compare_interventions to ground your summary, then report where the candidates genuinely disagree on facts, values, or risk tolerance.\n\nRespond with ONLY JSON matching:\n{"summary": string, "disagreements": string[]}`,
        systemPrompt: debateResolved.role.systemPrompt,
        modelName: debateResolved.model.modelName,
        llmProvider: debateResolved.model.provider,
        tools: getToolDefinitions(debateResolved.role.toolNames),
        thinking: debateResolved.role.thinking,
        memory: debateResolved.role.memory,
        context,
        schema: debateSchema,
        onToolCallStart: (call) => emit({ type: "tool.requested", runId, role: "final-policy-judge", toolName: call.name }),
        onToolCallEnd: (outcome) =>
          emit({ type: "tool.completed", runId, role: "final-policy-judge", toolName: outcome.toolName, ok: outcome.ok }),
      });
      debateSummary = debateTurn.value.summary;
      emit({ type: "agent.completed", runId, role: "final-policy-judge", name: debateResolved.role.name, summary: debateSummary });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emit({ type: "agent.failed", runId, role: "final-policy-judge", name: debateResolved.role.name, error: message });
      debateSummary = `Deterministic ranking stands: ${ranking.map((entry) => `${entry.interventionId} (rank ${entry.rank}${entry.disqualified ? ", disqualified" : ""})`).join(", ")}.`;
      emit({ type: "agent.completed", runId, role: "final-policy-judge", name: debateResolved.role.name, summary: debateSummary });
    }
    recordParticipant("final-policy-judge");
    emit({ type: "debate.completed", runId, summary: debateSummary });

    // -- Final judgment --------------------------------------------------------------
    const candidateIds = candidates.map((candidate) => candidate.id);
    const judgeDecisionSchema = z
      .object({
        chosenCandidateId: z.string().min(1),
        headline: z.string().min(1).max(200),
        reasoning: z.string().min(1).max(2000),
        tradeoffs: z.array(z.string().max(300)).max(10).default([]),
        confidence: z.number().min(0).max(1),
        recommendedAction: z.enum(["approve", "approve_with_monitoring", "hold_for_operator", "reject_unsafe"]),
      })
      .strict()
      .superRefine((data, ctx) => {
        if (!candidateIds.includes(data.chosenCandidateId)) {
          ctx.addIssue({
            code: "custom",
            message: `chosenCandidateId must be one of: ${candidateIds.join(", ")}.`,
            path: ["chosenCandidateId"],
          });
        }
      });

    const judgeResolved = await resolveAssistant("final-policy-judge", adapter);
    emit({ type: "agent.started", runId, role: "final-policy-judge", name: judgeResolved.role.name });

    const fallbackRank = ranking.find((entry) => !entry.disqualified) ?? ranking[0];
    let aiRecommendation: FinalPolicyRecommendation;
    let judgeThreadId: string;
    try {
      const judgeTurn = await runStructuredTurn({
        adapter,
        assistantId: judgeResolved.record.assistantId,
        content: `${scenarioContextBlock(scenario)}\n\nDebate summary: ${debateSummary}\n\nDeterministic ranking (rank 1 = best; disqualified candidates failed hard validation and must never be recommended):\n${JSON.stringify(ranking)}\n\nImpact reviews, including feasibility and value evidence:\n${JSON.stringify(impactOutcomes.map((outcome) => ({ role: outcome.role, finding: outcome.finding })))}\n\nStress-test results:\n${JSON.stringify(evaluations.map((evaluation) => ({ candidateId: evaluation.candidateId, invalidated: evaluation.stress?.invalidated ?? null })))}\n\nCall compare_interventions, calculate_accessibility, and calculate_equity as needed to confirm every claim before deciding. Write the reasoning as concise Markdown with relevant sections for Why this option, Sustainability potential, Screening metrics, ROI and value case, Success KPIs to validate, and What to validate next. In ROI and value case, preserve the feasibility evidence boundary: separate measured inputs, modeled monetized benefits, assumptions, and scenario ranges; claim no ROI figure when lifecycle cost or benefit evidence is absent.\n\nRespond with ONLY JSON matching:\n{"chosenCandidateId": string, "headline": string, "reasoning": string, "tradeoffs": string[], "confidence": number between 0 and 1, "recommendedAction": "approve"|"approve_with_monitoring"|"hold_for_operator"|"reject_unsafe"}\n\nNever choose a disqualified candidateId. Use "hold_for_operator" whenever every candidate has material unresolved concerns, and "reject_unsafe" whenever a candidate's own evidence shows it fails a hard check.`,
        systemPrompt: judgeResolved.role.systemPrompt,
        modelName: judgeResolved.model.modelName,
        llmProvider: judgeResolved.model.provider,
        tools: getToolDefinitions(judgeResolved.role.toolNames),
        thinking: judgeResolved.role.thinking,
        memory: judgeResolved.role.memory,
        context,
        schema: judgeDecisionSchema,
      });
      aiRecommendation = finalPolicyRecommendationSchema.parse({ ...judgeTurn.value, dataMode: "synthetic-fixture" });
      judgeThreadId = judgeTurn.result.finalResult.threadId;
      emit({ type: "agent.completed", runId, role: "final-policy-judge", name: judgeResolved.role.name, summary: aiRecommendation.headline });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emit({ type: "agent.failed", runId, role: "final-policy-judge", name: judgeResolved.role.name, error: message });
      aiRecommendation = finalPolicyRecommendationSchema.parse({
        chosenCandidateId: fallbackRank?.interventionId ?? candidateIds[0],
        headline: fallbackRank && !fallbackRank.disqualified ? `Deterministic fallback: ${fallbackRank.interventionId}` : "Hold for operator review",
        reasoning: `The Final Policy Judge did not return valid structured output (${message}). Falling back to the deterministic ranking.`,
        tradeoffs: [],
        confidence: 0.3,
        recommendedAction: fallbackRank && !fallbackRank.disqualified ? "hold_for_operator" : "hold_for_operator",
        dataMode: "synthetic-fixture",
      });
      judgeThreadId = `local-fallback-${runId}`;
      emit({ type: "agent.completed", runId, role: "final-policy-judge", name: judgeResolved.role.name, summary: aiRecommendation.headline });
    }
    recordParticipant("final-policy-judge");

    const { effectiveRecommendation, overridden, overrideReason } = applyFinalAuthority({
      evaluations,
      ranking,
      chosen: aiRecommendation,
      stressOverlayAvailable,
    });
    emit({
      type: "recommendation.ready",
      runId,
      recommendation: effectiveRecommendation,
      overridden,
      overrideReason: overrideReason ?? undefined,
    });
    emit({
      type: "operator.ready",
      runId,
      question:
        effectiveRecommendation.recommendedAction === "hold_for_operator"
          ? "This run requires operator review before proceeding. Ask why, or ask what would change the recommendation."
          : "Ask the TTC Operator Explanation Agent anything about this recommendation.",
    });

    const result: TechTORunResult = {
      runId,
      scenarioId: input.scenarioId,
      problemSummary: problemOutcome.finding.summary,
      baselineSummary: baselineOutcome.finding.summary,
      candidates,
      simulations: evaluations.map((evaluation) => ({ candidateId: evaluation.candidateId, result: evaluation.simulation })),
      stressResults: evaluations
        .filter((evaluation): evaluation is CandidateEvaluation & { stress: StressTestOutcome } => evaluation.stress !== null)
        .map((evaluation) => ({ candidateId: evaluation.candidateId, result: evaluation.stress })),
      citizenReactions: evaluations
        .filter(
          (evaluation): evaluation is CandidateEvaluation & { citizenReactions: CitizenReactionBatchResult } =>
            evaluation.citizenReactions !== null,
        )
        .map((evaluation) => ({ candidateId: evaluation.candidateId, result: evaluation.citizenReactions })),
      ranking,
      aiRecommendation,
      effectiveRecommendation,
      recommendationOverridden: overridden,
      overrideReason,
      judgeAssistantId: judgeResolved.record.assistantId,
      judgeThreadId,
      participatingAgents,
    };
    emit({ type: "run.completed", runId, result });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit({ type: "run.failed", runId, error: message });
    throw error;
  }
}
