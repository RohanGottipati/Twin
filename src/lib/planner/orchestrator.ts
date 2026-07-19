import { randomUUID } from "node:crypto";
import { z } from "zod";

import { getBackboardAdapter } from "@/lib/backboard/adapter";
import { resolveAssistant } from "@/lib/backboard/assistant-manifest";
import type { BackboardAdapter } from "@/lib/backboard/client";
import { runToolLoop } from "@/lib/backboard/run-tool-loop";
import { createRunContext, type ToolCallOutcome } from "@/lib/backboard/tool-dispatcher";
import { getToolDefinitions, TOOL_NAMES } from "@/lib/backboard/tools";
import type { TwinTOAssistantKey } from "@/lib/backboard/assistants";
import type { ScenarioPatch } from "@/lib/planner/scenario";
import { emptyTwinSnapshot, patchTwin } from "@/lib/planner/state";
import {
  getPopulationProvider,
  type PopulationProvider,
} from "@/lib/population/provider";
import type { PopulationScoreResult } from "@/lib/population/score";
import type { MapAction } from "@/lib/twinto/map-actions";
import type { AgentMapOverlay } from "@/lib/twinto/map-overlays";
import { parseMapActions } from "@/lib/twinto/map-actions";

export type CityRunEvent =
  | { type: "run.started"; runId: string; question: string }
  | { type: "agent.started"; runId: string; role: TwinTOAssistantKey; name: string }
  | { type: "tool.requested"; runId: string; role: TwinTOAssistantKey; toolName: string }
  | { type: "tool.completed"; runId: string; role: TwinTOAssistantKey; toolName: string; ok: boolean }
  | { type: "scenarios.proposed"; runId: string; patches: ScenarioPatch[] }
  | {
      type: "citizens.scored";
      runId: string;
      candidateId: string;
      mean: number;
      supportShare: number;
      provider: string;
    }
  | {
      type: "recommendation.ready";
      runId: string;
      ranking: Array<{ id: string; title: string; mean: number; supportShare: number }>;
      chosenId: string;
      summary: string;
    }
  | { type: "run.completed"; runId: string };

export interface CityCandidateResult {
  patch: ScenarioPatch;
  score: PopulationScoreResult;
  twinVersion: number;
}

export interface CityOrchestrationResult {
  runId: string;
  question: string;
  participatingAgents: TwinTOAssistantKey[];
  candidates: CityCandidateResult[];
  ranking: Array<{ id: string; title: string; mean: number; supportShare: number }>;
  chosenId: string;
  summary: string;
  events: CityRunEvent[];
  toolCallLog: ToolCallOutcome[];
  adapterMode: "live";
  mapActions: MapAction[];
}

export interface RunCityOrchestrationInput {
  question: string;
  patches?: ScenarioPatch[];
  adapter?: BackboardAdapter;
  population?: PopulationProvider;
  onEvent?: (event: CityRunEvent) => void;
  seed?: number;
  /** Current UI map drawings so collision checks see what the user already sees. */
  agentOverlays?: AgentMapOverlay[];
}

const optionalMetaSchema = z.object({
  ranking: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        mean: z.number(),
        supportShare: z.number(),
      }),
    )
    .optional(),
  chosenId: z.string().optional(),
  summary: z.string().optional(),
});

function emit(
  events: CityRunEvent[],
  onEvent: ((e: CityRunEvent) => void) | undefined,
  event: CityRunEvent,
) {
  events.push(event);
  onEvent?.(event);
}

async function harvestScores(
  patches: ScenarioPatch[],
  question: string,
  seed: number | undefined,
  pop: PopulationProvider,
  personas: Awaited<ReturnType<PopulationProvider["load"]>>,
): Promise<CityCandidateResult[]> {
  return Promise.all(
    patches.map(async (patch) => {
      const twin = patchTwin(emptyTwinSnapshot(), patch);
      const score = await pop.score({
        personas,
        twin,
        question,
        scenarioId: patch.id,
        seed,
      });
      return { patch, score, twinVersion: twin.version };
    }),
  );
}

function extractReply(raw: string | null | undefined): {
  text: string;
  ranking?: z.infer<typeof optionalMetaSchema>["ranking"];
  chosenId?: string;
} {
  const content = (raw ?? "").trim();
  if (!content) return { text: "" };

  // model sometimes wraps meta in a JSON blob; prefer prose when present
  if (content.startsWith("{")) {
    try {
      const parsed = optionalMetaSchema.parse(JSON.parse(content));
      return {
        text: parsed.summary?.trim() || content,
        ranking: parsed.ranking,
        chosenId: parsed.chosenId,
      };
    } catch {
      // fall through: treat as prose
    }
  }

  // trailing JSON block after prose
  const fence = content.match(/\{[\s\S]*"ranking"[\s\S]*\}\s*$/);
  if (fence) {
    try {
      const parsed = optionalMetaSchema.parse(JSON.parse(fence[0]));
      const prose = content.slice(0, fence.index).trim();
      return {
        text: prose || parsed.summary?.trim() || content,
        ranking: parsed.ranking,
        chosenId: parsed.chosenId,
      };
    } catch {
      // ignore
    }
  }

  return { text: content };
}

/**
 * Live Backboard Planning Orchestrator: free-form agent turn with tools.
 * Scores citizens only when the agent (or caller) actually proposed patches.
 */
export async function runCityOrchestration(
  input: RunCityOrchestrationInput,
): Promise<CityOrchestrationResult> {
  const runId = randomUUID();
  const events: CityRunEvent[] = [];
  const onEvent = input.onEvent;
  const pop = input.population ?? getPopulationProvider();
  const seed = input.seed ?? 2262;
  const adapter = input.adapter ?? getBackboardAdapter();

  emit(events, onEvent, { type: "run.started", runId, question: input.question });

  const orch = await resolveAssistant("planning-orchestrator", adapter);
  emit(events, onEvent, {
    type: "agent.started",
    runId,
    role: "planning-orchestrator",
    name: orch.role.name,
  });

  const context = createRunContext("open-city", adapter, undefined, runId, {
    populationProvider: pop,
    populationSeed: seed,
    agentOverlays: input.agentOverlays,
  });

  const hintPatches = input.patches?.length ? input.patches : [];

  const content = [
    `User message: ${input.question}`,
    "",
    "Respond as TechTO's planning agent (Claude Code for the city).",
    "You decide the whole turn: reply in prose, call tools, invoke specialists, or any mix.",
    "Tools are available and optional; use them only when they help.",
    "Never invent ScenarioPatches or fake rankings just to fill a pipeline.",
    "If you score population acceptance, say it is simulated day-one feel, not ridership.",
    "When comparing places or proposing geometry, use compose_map_actions to fly/highlight/draw on the map so the user can see it.",
    "For recommendations, use concise sections when relevant: Recommendation, Why this area, Screening metrics, ROI and value case, Success KPIs, and What to validate next.",
    "In ROI and value case, separate measured inputs, modeled monetized benefits, assumptions, and scenario ranges. Calculate ROI only when both lifecycle costs and monetized benefits are evidenced; otherwise state that no ROI figure is being claimed yet.",
    hintPatches.length
      ? `Caller supplied optional starter patches (use or ignore):\n${JSON.stringify(hintPatches)}`
      : "",
    "Final reply: plain prose to the user. Be concise; no rambling.",
  ]
    .filter(Boolean)
    .join("\n");

  const loop = await runToolLoop({
    adapter,
    assistantId: orch.record.assistantId,
    content,
    systemPrompt: orch.role.systemPrompt,
    modelName: orch.model.modelName,
    llmProvider: orch.model.provider,
    tools: getToolDefinitions(orch.role.toolNames),
    thinking: orch.role.thinking,
    memory: orch.role.memory,
    context,
    maxRounds: 12,
    jsonOutput: false,
    onToolCallStart: (call) =>
      emit(events, onEvent, {
        type: "tool.requested",
        runId,
        role: "planning-orchestrator",
        toolName: call.name,
      }),
    onToolCallEnd: (outcome) => {
      emit(events, onEvent, {
        type: "tool.completed",
        runId,
        role: "planning-orchestrator",
        toolName: outcome.toolName,
        ok: outcome.ok,
      });
      if (outcome.ok && outcome.toolName === TOOL_NAMES.PROPOSE_SCENARIOS) {
        const patches = (outcome.output as { patches?: ScenarioPatch[] }).patches ?? [];
        if (patches.length) emit(events, onEvent, { type: "scenarios.proposed", runId, patches });
      }
      if (outcome.ok && outcome.toolName === TOOL_NAMES.SCORE_POPULATION) {
        const out = outcome.output as {
          scenarioId?: string;
          citywide?: { mean: number; supportShare: number };
          provider?: string;
        };
        if (out.scenarioId && out.citywide) {
          emit(events, onEvent, {
            type: "citizens.scored",
            runId,
            candidateId: out.scenarioId,
            mean: out.citywide.mean,
            supportShare: out.citywide.supportShare,
            provider: out.provider ?? "unknown",
          });
        }
      }
    },
  });

  // only patches the agent (or explicit caller input) put forward; never invent
  let patches = context.proposedCityPatches;
  if (!patches.length && input.patches?.length) {
    patches = input.patches;
    emit(events, onEvent, { type: "scenarios.proposed", runId, patches });
  }

  let candidates: CityCandidateResult[] = [];
  if (patches.length) {
    const personas = await pop.load();
    candidates = await harvestScores(patches, input.question, seed, pop, personas);
  }

  const reply = extractReply(loop.finalResult.content);
  const rankingFromScores = candidates
    .map((c) => ({
      id: c.patch.id,
      title: c.patch.title,
      mean: c.score.citywide.mean,
      supportShare: c.score.citywide.supportShare,
    }))
    .sort((a, b) => b.mean - a.mean);

  const ranking = reply.ranking?.length ? reply.ranking : rankingFromScores;
  const chosenId = reply.chosenId ?? (ranking.length ? ranking[0]!.id : "");
  const summary =
    reply.text ||
    (ranking.length
      ? `Scored ${ranking.length} scenario(s); leading candidate ${chosenId}.`
      : "Done.");

  emit(events, onEvent, {
    type: "recommendation.ready",
    runId,
    ranking,
    chosenId,
    summary,
  });
  emit(events, onEvent, { type: "run.completed", runId });

  const participatingAgents: TwinTOAssistantKey[] = ["planning-orchestrator"];
  for (const role of context.invokedAssistants) {
    if (!participatingAgents.includes(role as TwinTOAssistantKey)) {
      participatingAgents.push(role as TwinTOAssistantKey);
    }
  }

  const mapParsed = parseMapActions(context.composedMapActions);
  const mapActions = mapParsed.ok ? mapParsed.actions : [];

  return {
    runId,
    question: input.question,
    participatingAgents,
    candidates,
    ranking,
    chosenId,
    summary,
    events,
    toolCallLog: loop.toolCallLog,
    adapterMode: "live",
    mapActions,
  };
}
