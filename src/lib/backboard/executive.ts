import { z } from "zod";

import { getBackboardAdapter } from "@/lib/backboard/adapter";
import { resolveAssistant } from "@/lib/backboard/assistant-manifest";
import type { BackboardAdapter } from "@/lib/backboard/client";
import type { CandidateEvaluation, TwinTORunResult } from "@/lib/backboard/orchestrator";
import { runToolLoop } from "@/lib/backboard/run-tool-loop";
import { createRunContext } from "@/lib/backboard/tool-dispatcher";
import { transitExecutiveSummarySchema, type TransitExecutiveSummary } from "@/lib/transit/schemas";

export class ExecutiveSummaryError extends Error {}

export interface BuildExecutiveSummaryInput {
  result: TwinTORunResult;
  adapter?: BackboardAdapter;
}

/**
 * Only the four prose fields a model is allowed to author. The numeric
 * fields and safetyResult on TransitExecutiveSummary are always computed
 * locally from TwinTORunResult (see buildExecutiveSummary) and never
 * requested from, or overwritten by, the model.
 */
const narrativeSchema = z
  .object({
    mainRisk: z.string().min(1).max(500),
    majorAssumption: z.string().min(1).max(500),
    limitations: z.string().min(1).max(500),
    summary: z.string().min(1).max(800),
  })
  .strict();

type ExecutiveNarrative = z.output<typeof narrativeSchema>;

function findChosenSimulation(result: TwinTORunResult) {
  const entry = result.simulations.find(
    (simulation) => simulation.candidateId === result.effectiveRecommendation.chosenCandidateId,
  );
  if (!entry) {
    throw new ExecutiveSummaryError(
      `Chosen candidateId "${result.effectiveRecommendation.chosenCandidateId}" was not found among simulated candidates for run ${result.runId}.`,
    );
  }
  return entry.result;
}

function computeSafetyResult(result: TwinTORunResult): TransitExecutiveSummary["safetyResult"] {
  if (result.recommendationOverridden) return "overridden_for_safety";
  if (result.effectiveRecommendation.recommendedAction === "hold_for_operator") return "hold_for_operator";
  return "clear";
}

/** Numbers only ever come from here: TransitMetrics on the chosen candidate's simulation. */
function computeMetricFields(
  simulation: ReturnType<typeof findChosenSimulation>,
): Pick<
  TransitExecutiveSummary,
  "meanWaitMinutes" | "deniedBoardings" | "loadImbalance" | "equityGap" | "estimatedCarbonKg" | "operatingCostScore"
> {
  return {
    meanWaitMinutes: simulation.metrics.meanWaitMinutes,
    deniedBoardings: simulation.metrics.deniedBoardings,
    loadImbalance: simulation.metrics.loadImbalance,
    equityGap: simulation.metrics.equityGap,
    estimatedCarbonKg: simulation.metrics.estimatedCarbonKg,
    operatingCostScore: simulation.metrics.operatingCostScore,
  };
}

function findStress(result: TwinTORunResult): CandidateEvaluation["stress"] | null {
  const entry = result.stressResults.find(
    (stress) => stress.candidateId === result.effectiveRecommendation.chosenCandidateId,
  );
  return entry?.result ?? null;
}

/**
 * Deterministic fallback narrative built directly from run data, no model
 * call involved. Used in mock mode and whenever a live narrative request
 * fails or comes back malformed, so buildExecutiveSummary always succeeds.
 */
function buildLocalNarrative(result: TwinTORunResult): ExecutiveNarrative {
  const stress = findStress(result);
  const mainRisk = stress?.invalidated
    ? stress.invalidationReasons[0] ?? "This candidate is invalidated under the hidden stress overlay."
    : "No candidate-specific risk was flagged under the visible or hidden stress conditions.";
  const majorAssumption = "The synthetic-fixture passenger arrival curve and cohort weights hold through the scenario horizon.";
  const limitations = stress
    ? "Stress performance was checked against a hidden concert-surge overlay; no other event types were tested."
    : "This run's candidates were not checked against a hidden stress scenario.";
  const chosenSimulation = findChosenSimulation(result);
  const summary =
    `${result.effectiveRecommendation.headline} Candidate "${result.effectiveRecommendation.chosenCandidateId}" is projected at ` +
    `${chosenSimulation.metrics.meanWaitMinutes.toFixed(1)} minute mean wait and ${chosenSimulation.metrics.deniedBoardings} denied boarding(s) over the scenario window.`;
  return { mainRisk, majorAssumption, limitations, summary };
}

function buildNarrativePrompt(result: TwinTORunResult): string {
  const chosenSimulation = findChosenSimulation(result);
  return `
Write the city-planner executive summary for this already-decided TwinTO run.
Do not restate or invent any numbers; the dashboard renders the simulated
metrics separately from your text.

Chosen candidate: "${result.effectiveRecommendation.chosenCandidateId}".
Effective recommendation: ${JSON.stringify(result.effectiveRecommendation)}
Recommendation overridden for safety: ${result.recommendationOverridden}${
    result.overrideReason ? ` (${result.overrideReason})` : ""
  }
Chosen candidate metrics: ${JSON.stringify(chosenSimulation.metrics)}
Stress-test result for the chosen candidate: ${JSON.stringify(findStress(result))}

Respond with ONLY JSON matching:
{"mainRisk": string, "majorAssumption": string, "limitations": string, "summary": string}

- mainRisk: the single most important risk a planner should know about this choice.
- majorAssumption: the one assumption this plan leans on most heavily.
- limitations: what this run's evidence does NOT tell you (e.g. untested conditions).
- summary: one or two planner-facing sentences on the outcome, in plain language.

Never claim this reflects real Toronto public opinion; every citizen reaction in this run is simulated.
`.trim();
}

function parseNarrative(raw: string | null): ExecutiveNarrative | null {
  if (!raw || raw.trim().length === 0) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = narrativeSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/**
 * Produces the TransitExecutiveSummary for one completed TwinTORunResult. In
 * mock mode (or on any failure talking to a live model) the narrative is
 * built deterministically from run data; live mode asks the Executive
 * Summary Agent, on a fresh thread, for the four prose fields only. All
 * numbers and safetyResult are computed here, never from model output.
 */
export async function buildExecutiveSummary(input: BuildExecutiveSummaryInput): Promise<TransitExecutiveSummary> {
  const { result } = input;
  const adapter = input.adapter ?? getBackboardAdapter();
  const chosenSimulation = findChosenSimulation(result);

  const baseFields = {
    ...computeMetricFields(chosenSimulation),
    safetyResult: computeSafetyResult(result),
  };
  const localNarrative = buildLocalNarrative(result);

  if (adapter.mode === "mock") {
    return transitExecutiveSummarySchema.parse({ ...baseFields, ...localNarrative });
  }

  try {
    const resolved = await resolveAssistant("explanation-map-action-agent", adapter);
    const context = createRunContext(result.scenarioId, adapter);
    const loop = await runToolLoop({
      adapter,
      assistantId: resolved.record.assistantId,
      content: buildNarrativePrompt(result),
      systemPrompt: resolved.role.systemPrompt,
      modelName: resolved.model.modelName,
      llmProvider: resolved.model.provider,
      thinking: resolved.role.thinking,
      memory: resolved.role.memory,
      jsonOutput: true,
      context,
      maxRounds: 1,
    });
    const narrative = parseNarrative(loop.finalResult.content);
    return transitExecutiveSummarySchema.parse({ ...baseFields, ...(narrative ?? localNarrative) });
  } catch {
    return transitExecutiveSummarySchema.parse({ ...baseFields, ...localNarrative });
  }
}
