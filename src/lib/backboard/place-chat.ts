import {
  ASSISTANT_ROSTER,
  type PlanningIntent,
  type TechTOAssistantKey,
} from "@/lib/backboard/assistants";
import { getBackboardAdapter } from "@/lib/backboard/adapter";
import { resolveAssistant } from "@/lib/backboard/assistant-manifest";
import type { BackboardAdapter, WebSearchMode } from "@/lib/backboard/client";
import { runToolLoop } from "@/lib/backboard/run-tool-loop";
import { createRunContext, type MapContextState } from "@/lib/backboard/tool-dispatcher";
import { getToolDefinitions } from "@/lib/backboard/tools";
import { classifyPlanningIntent } from "@/lib/techto/intent";
import type { SelectedMapPlace } from "@/lib/techto/place-context";
import { parseMapActions, type MapAction } from "@/lib/techto/map-actions";
import { TORONTO_SCOPE_SHORT } from "@/lib/techto/toronto-scope";
import { z } from "zod";

export class PlaceChatError extends Error {}

const placeChatAnswerSchema = z
  .object({
    answer: z.string().min(1),
    citedEvidence: z.array(z.string()).default([]),
    mapActions: z.array(z.unknown()).optional(),
  })
  .strict();

export type PlaceChatAnswer = z.output<typeof placeChatAnswerSchema>;

/**
 * Pick the single best conversational specialist for a place-scoped or
 * map-bar question. Full planning bundles still go through the orchestrator;
 * this path answers with one tool-enabled assistant grounded in TechTO data.
 */
export function selectChatAgentForTask(input: {
  intent: PlanningIntent;
  placeScoped: boolean;
}): TechTOAssistantKey {
  if (input.placeScoped) {
    if (input.intent === "SCHEDULE_CHANGE") return "geospatial-twin";
    if (input.intent === "EVENT_RESPONSE") return "adversarial-reviewer";
    if (input.intent === "COMPARE_EXISTING_CANDIDATES") return "explanation-map";
    return "geospatial-twin";
  }
  if (input.intent === "COMPARE_EXISTING_CANDIDATES") return "explanation-map";
  if (input.intent === "EVENT_RESPONSE") return "adversarial-reviewer";
  if (input.intent === "SCHEDULE_CHANGE") return "city-copilot";
  if (input.intent === "NEW_STATION_LOCATION") return "geospatial-twin";
  return "city-copilot";
}

export interface AskPlaceChatInput {
  scenarioId: string;
  question: string;
  conversationContext?: string;
  threadId?: string;
  place?: SelectedMapPlace | null;
  mapContext?: Partial<MapContextState>;
  webSearch?: WebSearchMode;
  adapter?: BackboardAdapter;
  onDelta?: (contentDelta: string) => void;
}

export interface AskPlaceChatResult {
  answer: PlaceChatAnswer;
  threadId: string;
  assistantId: string;
  assistantKey: TechTOAssistantKey;
  intent: PlanningIntent;
  mapActions: MapAction[];
}

function buildPlacePrompt(input: AskPlaceChatInput, intent: PlanningIntent, agentKey: TechTOAssistantKey): string {
  const place = input.place;
  const placeBlock = place
    ? [
        `Selected map place:`,
        `- kind: ${place.kind}`,
        `- label: ${place.label}`,
        `- coordinates: [${place.coordinates[0]}, ${place.coordinates[1]}]`,
        `- nearestStationId: ${place.stationId ?? "none"}`,
        `- neighbourhoodId: ${place.neighbourhoodId ?? "none"}`,
      ].join("\n")
    : "No specific building or station is selected; answer for citywide Toronto context.";
  const conversationBlock = input.conversationContext?.trim()
    ? `Recent conversation for follow-up context:\n${input.conversationContext.trim()}`
    : "No earlier conversation context was provided.";

  return `
${TORONTO_SCOPE_SHORT}

You are answering as ${ASSISTANT_ROSTER[agentKey].name} (${agentKey}).
Classified intent: ${intent}.
Scenario: ${input.scenarioId}.

${placeBlock}

${conversationBlock}

User question: ${input.question}

Rules:
- Use your tools to read TechTO / Mongo-backed transit and neighbourhood data before answering.
- Ground every factual claim in tool results. Label synthetic fixture data clearly.
- Never present simulated citizen reactions as real public opinion.
- If the question is about this building or place, relate it to the nearest station and neighbourhood from tools.
- Answer the user's actual question directly. Do not substitute a generic description of what you can explain.
- Make the answer easy to scan with short Markdown paragraphs, headings, and bullet lists when useful.
- For a location, intervention, or policy recommendation, separate: recommendation, why it fits, sustainability potential, measured screening metrics, ROI and value case, proposed success KPIs, and next validation steps.
- Keep measured indicators separate from projected KPIs. Frame sustainability outcomes as potential mechanisms until validated, not forecasts or promises.
- In ROI and value case, separate measured inputs, modeled monetized benefits, unvalidated assumptions, and scenario ranges. Use ROI = (validated monetized benefits - lifecycle costs) / lifecycle costs only when both sides are evidenced. Otherwise state that no ROI figure is claimed until demand, lifecycle cost, and benefit assumptions are validated. Include NPV, benefit-cost ratio, payback, discount rate, horizon, and sensitivity when available.

Respond with ONLY JSON matching:
{"answer": string, "citedEvidence": string[], "mapActions": unknown[]}
`.trim();
}

function parsePlaceAnswer(raw: string | null): { ok: true; value: PlaceChatAnswer } | { ok: false; error: string } {
  if (!raw || raw.trim().length === 0) {
    return { ok: false, error: "The response content was empty." };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      error: `The response was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const parsed = placeChatAnswerSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((issue) => `- ${issue.path.join(".") || "(root)"}: ${issue.message}`).join("\n"),
    };
  }
  return { ok: true, value: parsed.data };
}

/**
 * Live Backboard turn for map-bar or building mini-chat. Resolves the best
 * roster assistant for the classified intent, runs its tool loop against the
 * TechTO repository (Mongo when configured), and returns a structured answer.
 */
export async function askPlaceChat(input: AskPlaceChatInput): Promise<AskPlaceChatResult> {
  const adapter = input.adapter ?? getBackboardAdapter();
  const intent = classifyPlanningIntent(input.question);
  const assistantKey = selectChatAgentForTask({
    intent,
    placeScoped: Boolean(input.place),
  });
  const resolved = await resolveAssistant(assistantKey, adapter);

  const mapContext: Partial<MapContextState> = {
    ...input.mapContext,
    center: input.place?.coordinates ?? input.mapContext?.center,
    selectedStationId: input.place?.stationId ?? input.mapContext?.selectedStationId ?? null,
    selectedNeighbourhoodId:
      input.place?.neighbourhoodId ?? input.mapContext?.selectedNeighbourhoodId ?? null,
  };
  const context = createRunContext(input.scenarioId, adapter, mapContext);
  const tools = getToolDefinitions(resolved.role.toolNames);

  let loop = await runToolLoop({
    adapter,
    assistantId: resolved.record.assistantId,
    threadId: input.threadId,
    content: buildPlacePrompt(input, intent, assistantKey),
    systemPrompt: resolved.role.systemPrompt,
    modelName: resolved.model.modelName,
    llmProvider: resolved.model.provider,
    tools,
    thinking: resolved.role.thinking,
    memory: resolved.role.memory,
    webSearch: input.webSearch,
    jsonOutput: true,
    context,
    onEvent: (event) => {
      if (event.type === "content_delta") {
        input.onDelta?.(event.content);
      }
    },
  });

  let attempt = parsePlaceAnswer(loop.finalResult.content);
  if (!attempt.ok) {
    const correction = `Your previous JSON response had the following problem(s):\n${attempt.error}\n\nReply again with ONLY the corrected, complete JSON object matching the required schema. Do not include any prose outside the JSON.`;
    loop = await runToolLoop({
      adapter,
      assistantId: resolved.record.assistantId,
      threadId: loop.finalResult.threadId,
      content: correction,
      systemPrompt: resolved.role.systemPrompt,
      modelName: resolved.model.modelName,
      llmProvider: resolved.model.provider,
      tools,
      thinking: resolved.role.thinking,
      memory: resolved.role.memory,
      webSearch: input.webSearch,
      jsonOutput: true,
      context,
      onEvent: (event) => {
        if (event.type === "content_delta") {
          input.onDelta?.(event.content);
        }
      },
    });
    attempt = parsePlaceAnswer(loop.finalResult.content);
  }

  if (!attempt.ok) {
    throw new PlaceChatError(`Place chat did not receive valid structured output: ${attempt.error}`);
  }

  const fromAnswer = parseMapActions(attempt.value.mapActions ?? []);
  const fromTools = parseMapActions(context.composedMapActions);
  const mapActions = [
    ...(fromTools.ok ? fromTools.actions : []),
    ...(fromAnswer.ok ? fromAnswer.actions : []),
  ];

  return {
    answer: attempt.value,
    threadId: loop.finalResult.threadId,
    assistantId: resolved.record.assistantId,
    assistantKey,
    intent,
    mapActions,
  };
}
