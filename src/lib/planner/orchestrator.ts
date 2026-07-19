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
import {
  scoreRealPolicyAcceptance,
  policyTextForPatch,
  type PolicyAcceptanceResult,
} from "@/lib/citizen-reaction/policy-acceptance";
import type { MapAction } from "@/lib/techto/map-actions";
import type { AgentMapOverlay } from "@/lib/techto/map-overlays";
import { focusPrimaryMapRecommendation, parseMapActions } from "@/lib/techto/map-actions";
import { clipToolDetail, toolOutputPreview } from "@/lib/planner/tool-detail";

export type CityRunEvent =
  | { type: "run.started"; runId: string; question: string }
  | { type: "agent.started"; runId: string; role: TechTOAssistantKey; name: string }
  | { type: "assistant.delta"; runId: string; content: string }
  | { type: "assistant.reasoning"; runId: string; content: string }
  | { type: "assistant.clear"; runId: string }
  | { type: "status"; runId: string; message: string }
  | {
      type: "tool.requested";
      runId: string;
      role: TechTOAssistantKey;
      toolName: string;
      toolCallId: string;
      /** Compact args preview for the toggleable detail pane. */
      detail?: string;
    }
  | {
      type: "tool.completed";
      runId: string;
      role: TechTOAssistantKey;
      toolName: string;
      toolCallId: string;
      ok: boolean;
      /** Compact output preview for the toggleable detail pane. */
      detail?: string;
    }
  | { type: "scenarios.proposed"; runId: string; patches: ScenarioPatch[] }
  | {
      type: "persona.scored";
      runId: string;
      personaId: string;
      code: string;
      acceptance: number;
      opinionText: string;
    }
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
  score: PolicyAcceptanceResult;
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
  onPersonaScored?: (result: { personaId: string; code: string; acceptance: number; opinionText: string }) => void,
): Promise<CityCandidateResult[]> {
  return Promise.all(
    patches.map(async (patch) => {
      const score = await scoreRealPolicyAcceptance(patch.id, policyTextForPatch(patch), { onPersonaScored });
      return { patch, score };
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
  const adapter = input.adapter ?? getBackboardAdapter();

  emit(events, onEvent, { type: "run.started", runId, question: input.question });

  const orch = await resolveAssistant("planning-orchestrator", adapter);
  emit(events, onEvent, {
    type: "agent.started",
    runId,
    role: "planning-orchestrator",
    name: orch.role.name,
  });

  const emitToolStart = (
    call: { id: string; name: string; arguments: Record<string, unknown> },
    role: TechTOAssistantKey,
  ) => {
    emit(events, onEvent, {
      type: "tool.requested",
      runId,
      role,
      toolName: call.name,
      toolCallId: call.id,
      detail: clipToolDetail(call.arguments),
    });
  };

  const emitToolEnd = (outcome: ToolCallOutcome, role: TechTOAssistantKey) => {
    emit(events, onEvent, {
      type: "tool.completed",
      runId,
      role,
      toolName: outcome.toolName,
      toolCallId: outcome.toolCallId,
      ok: outcome.ok,
      detail: outcome.ok ? toolOutputPreview(outcome.toolName, outcome.output) : clipToolDetail(outcome.output),
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
  };

  const context = createRunContext("open-city", adapter, undefined, runId, {
    agentOverlays: input.agentOverlays,
    onNestedToolStart: (call, role) =>
      emitToolStart(call, (role as TechTOAssistantKey) ?? "planning-orchestrator"),
    onNestedToolEnd: (outcome, role) =>
      emitToolEnd(outcome, (role as TechTOAssistantKey) ?? "planning-orchestrator"),
    onPersonaScored: (result) => {
      emit(events, onEvent, { type: "persona.scored", runId, ...result });
    },
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
    "You have many tool rounds; use them. Prefer explore → score → revise → recommend over a one-shot guess.",
    "For location / siting questions (stations, parks, facilities, corridors):",
    "- Screen multiple geographically distinct Toronto neighbourhoods (not just one corridor or the first hit).",
    "- Prefer run_python (pandas on DATA_DIR/census_profile.csv or Mongo) for ranking/filtering; use search_neighbourhoods / generate_station_candidates / propose_scenarios for shortlists.",
    "- Avoid query_city_layer dumps: only use it for a named neighbourhood or tiny top-N (limit ≤ 3). Big screens belong in run_python RESULT.",
    "- Score acceptance on the shortlist with score_population BEFORE recommending.",
    "- If scores look weak (low mean/support, or byNeighbourhood opposition at the proposed site), discard and try other areas; do not recommend a poorly accepted site unless the user wants that tradeoff.",
    "- While comparing, compose_map_actions may show several candidate markers; for the final pick, leave one marker, fly_to_center, and highlight that neighbourhood.",
    "Never invent ScenarioPatches or fake rankings just to fill a pipeline.",
    "When comparing places or proposing geometry, use compose_map_actions so the user can see the search on the map.",
    "Be concise. Lead with the answer in 1-3 sentences. Only add a short bullet list below it for the handful of details that actually change the decision (e.g. acceptance, a key tradeoff). Never pad with boilerplate section headers unless the user asks for that depth.",
    "If you score population acceptance or ROI, state the one-line caveat (simulated day-one feel, not ridership; no ROI claimed until inputs are validated) only once, briefly.",
    "For capital or operating recommendations where a value case is material, invoke the feasibility specialist when lifecycle cost or monetized-benefit evidence is needed, then summarize its result in a sentence or two.",
    hintPatches.length
      ? `Caller supplied optional starter patches (use or ignore):\n${JSON.stringify(hintPatches)}`
      : "",
    "Final reply: short, plain Markdown. No rambling, no restating the question, no closing summary paragraph.",
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
    maxRounds: 18,
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
      // model thinking tokens (Backboard reasoning_streaming); was dropped before
      if (streamEvent.type === "reasoning_delta" && streamEvent.content) {
        emit(events, onEvent, {
          type: "assistant.reasoning",
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
    onToolCallStart: (call) => emitToolStart(call, "planning-orchestrator"),
    onToolCallEnd: (outcome) => emitToolEnd(outcome, "planning-orchestrator"),
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
      message: "Scoring real citizen acceptance…",
    });
    candidates = await harvestScores(patches, (result) => {
      emit(events, onEvent, { type: "persona.scored", runId, ...result });
    });
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
