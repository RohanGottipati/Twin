import { randomUUID } from "node:crypto";
import { z } from "zod";

import { getBackboardAdapter } from "@/lib/backboard/adapter";
import { resolveAssistant } from "@/lib/backboard/assistant-manifest";
import type { BackboardAdapter } from "@/lib/backboard/client";
import { runToolLoop } from "@/lib/backboard/run-tool-loop";
import { createRunContext, type ToolCallOutcome } from "@/lib/backboard/tool-dispatcher";
import { getToolDefinitions, TOOL_NAMES } from "@/lib/backboard/tools";
import type { TechTOAssistantKey } from "@/lib/backboard/assistants";
import type { ScenarioPatch } from "@/lib/planner/scenario";
import { emptyTwinSnapshot, patchTwin } from "@/lib/planner/state";
import {
  getPopulationProvider,
  type PopulationProvider,
} from "@/lib/population/provider";
import type { PopulationScoreResult } from "@/lib/population/score";
import type { MapAction } from "@/lib/techto/map-actions";
import type { AgentMapOverlay } from "@/lib/techto/map-overlays";
import { focusPrimaryMapRecommendation, parseMapActions } from "@/lib/techto/map-actions";

export type CityRunEvent =
  | { type: "run.started"; runId: string; question: string }
  | { type: "agent.started"; runId: string; role: TechTOAssistantKey; name: string }
  | { type: "assistant.delta"; runId: string; content: string }
  | { type: "assistant.clear"; runId: string }
  | { type: "status"; runId: string; message: string }
  | {
      type: "tool.requested";
      runId: string;
      role: TechTOAssistantKey;
      toolName: string;
      toolCallId: string;
    }
  | {
      type: "tool.completed";
      runId: string;
      role: TechTOAssistantKey;
      toolName: string;
      toolCallId: string;
      ok: boolean;
    }
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
  | { type: "map.actions"; runId: string; actions: MapAction[] }
  | { type: "run.completed"; runId: string };

export interface CityCandidateResult {
  patch: ScenarioPatch;
  score: PopulationScoreResult;
  twinVersion: number;
}

export interface CityOrchestrationResult {
  runId: string;
  threadId: string;
  question: string;
  participatingAgents: TechTOAssistantKey[];
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
  /** Continue an existing Backboard thread for multi-turn City Code chat. */
  threadId?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
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
  const history = (input.history ?? [])
    .filter((turn) => turn.content.trim().length > 0)
    .slice(-12);

  const content = [
    history.length
      ? [
          "Recent conversation (oldest first):",
          ...history.map((turn) => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.content}`),
          "",
        ].join("\n")
      : "",
    `User message: ${input.question}`,
    "",
    "Respond as TechTO's planning agent (Claude Code for the city).",
    "You decide the whole turn: reply in prose, call tools, invoke specialists, or any mix.",
    "Tools are available and optional; use them only when they help.",
    "For location screening, use query_city_layer before choosing an official Toronto neighbourhood.",
    "Never invent ScenarioPatches or fake rankings just to fill a pipeline.",
    "If you score population acceptance, say it is simulated day-one feel, not ridership.",
    "When recommending a single place, compose_map_actions with exactly one show_candidate_markers entry (the chosen site), fly_to_center on it, and highlight that one neighbourhood. Do not put multiple candidate markers on the map unless the user explicitly asked to compare alternatives.",
    "When comparing places or proposing geometry, use compose_map_actions to fly/highlight/draw on the map so the user can see it.",
    "For recommendations, use concise Markdown sections when relevant: Recommendation, Why this area, Sustainability potential, Screening metrics, ROI and value case, Success KPIs to validate, and What to validate next. Include every section that applies; do not truncate to a one-line summary.",
    "Separate measured screening indicators from proposed KPIs. Sustainability outcomes are potential mechanisms until validated, not forecasts or promises.",
    "For capital or operating recommendations where a value case is material, invoke the feasibility specialist when lifecycle cost or monetized-benefit evidence is needed.",
    "In ROI and value case, separate measured inputs, modeled monetized benefits, unvalidated assumptions, and scenario ranges. Calculate ROI as (validated monetized benefits - lifecycle costs) / lifecycle costs only when both sides are evidenced. Otherwise state that no ROI figure is claimed until demand, lifecycle cost, and benefit assumptions are validated. Include NPV, benefit-cost ratio, payback period, discount rate, analysis horizon, and sensitivity range when evidence supports them.",
    hintPatches.length
      ? `Caller supplied optional starter patches (use or ignore):\n${JSON.stringify(hintPatches)}`
      : "",
    "Final reply: concise Markdown to the user with the full recommendation sections above when recommending. Lead with the answer; no rambling.",
  ]
    .filter(Boolean)
    .join("\n");

  let streamedAssistantText = "";

  const loop = await runToolLoop({
    adapter,
    assistantId: orch.record.assistantId,
    threadId: input.threadId,
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
    onEvent: (streamEvent) => {
      if (streamEvent.type === "content_delta" && streamEvent.content) {
        streamedAssistantText += streamEvent.content;
        emit(events, onEvent, {
          type: "assistant.delta",
          runId,
          content: streamEvent.content,
        });
      }
      // mid-turn tool round: wipe any partial prose so the final reply streams clean
      if (streamEvent.type === "tool_submit_required") {
        streamedAssistantText = "";
        emit(events, onEvent, { type: "assistant.clear", runId });
      }
    },
    onToolCallStart: (call) => {
      emit(events, onEvent, {
        type: "tool.requested",
        runId,
        role: "planning-orchestrator",
        toolName: call.name,
        toolCallId: call.id,
      });
    },
    onToolCallEnd: (outcome) => {
      emit(events, onEvent, {
        type: "tool.completed",
        runId,
        role: "planning-orchestrator",
        toolName: outcome.toolName,
        toolCallId: outcome.toolCallId,
        ok: outcome.ok,
      });
      if (outcome.ok && outcome.toolName === TOOL_NAMES.COMPOSE_MAP_ACTIONS) {
        const accepted = (outcome.output as { accepted?: MapAction[] }).accepted ?? [];
        if (accepted.length) {
          emit(events, onEvent, { type: "map.actions", runId, actions: accepted });
        }
      }
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
    emit(events, onEvent, {
      type: "status",
      runId,
      message: "Scoring day-one acceptance…",
    });
    const personas = await pop.load();
    candidates = await harvestScores(patches, input.question, seed, pop, personas);
    emit(events, onEvent, {
      type: "status",
      runId,
      message: "Acceptance scores ready",
    });
  }

  const reply = extractReply(loop.finalResult.content || streamedAssistantText);
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
      : "The planning agent finished without a written reply. Try asking again.");

  emit(events, onEvent, {
    type: "recommendation.ready",
    runId,
    ranking,
    chosenId,
    summary,
  });
  emit(events, onEvent, { type: "run.completed", runId });

  const participatingAgents: TechTOAssistantKey[] = ["planning-orchestrator"];
  for (const role of context.invokedAssistants) {
    if (!participatingAgents.includes(role as TechTOAssistantKey)) {
      participatingAgents.push(role as TechTOAssistantKey);
    }
  }

  const mapParsed = parseMapActions(context.composedMapActions);
  const mapActions = mapParsed.ok
    ? focusPrimaryMapRecommendation(mapParsed.actions)
    : [];

  return {
    runId,
    threadId: loop.finalResult.threadId,
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
