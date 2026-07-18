import { randomUUID } from "node:crypto";

import { selectAssistantsForIntent } from "@/lib/backboard/assistants";
import {
  cityCopilotResponseSchema,
  type ChatMessageRecord,
  type ChatThreadRecord,
  type CityCopilotResponse,
  type PostChatMessageInput,
} from "@/lib/chat/schemas";
import { searchNeighbourhoods } from "@/data/transit/neighbourhoods";
import { FLAGSHIP_SCENARIO_ID } from "@/data/transit/scenarios";
import { getMongoDb } from "@/lib/mongodb/client";
import { COLLECTIONS, DEMO_PROVENANCE } from "@/lib/mongodb/collections";
import { isMongoConfigured } from "@/lib/mongodb/env";
import { classifyPlanningIntent } from "@/lib/twinto/intent";
import { parseMapActions } from "@/lib/twinto/map-actions";
import {
  TORONTO_SCOPE_ASSUMPTIONS,
  TORONTO_SCOPE_LIMITATIONS,
  TORONTO_SCOPE_SHORT,
} from "@/lib/twinto/toronto-scope";

const MEMORY_THREADS = new Map<string, ChatThreadRecord>();

function nowIso(): string {
  return new Date().toISOString();
}

async function loadThread(threadId: string): Promise<ChatThreadRecord | null> {
  if (isMongoConfigured()) {
    try {
      const db = await getMongoDb();
      const doc = await db.collection(COLLECTIONS.backboardThreads).findOne({
        threadId,
        kind: "city-copilot",
      });
      if (!doc) return null;
      return {
        threadId: String(doc.threadId),
        cityId: "toronto",
        status: (doc.status as "active" | "archived") ?? "active",
        messages: (doc.messages as ChatMessageRecord[]) ?? [],
        createdAt: String(doc.createdAt ?? nowIso()),
        updatedAt: String(doc.updatedAt ?? nowIso()),
      };
    } catch {
      // fall through to memory
    }
  }
  return MEMORY_THREADS.get(threadId) ?? null;
}

async function saveThread(thread: ChatThreadRecord): Promise<void> {
  MEMORY_THREADS.set(thread.threadId, thread);
  if (!isMongoConfigured()) return;
  try {
    const db = await getMongoDb();
    await db.collection(COLLECTIONS.backboardThreads).updateOne(
      { threadId: thread.threadId },
      {
        $set: {
          ...thread,
          kind: "city-copilot",
          provenance: DEMO_PROVENANCE,
        },
      },
      { upsert: true },
    );
  } catch {
    // memory already holds the thread
  }
}

const OUTSIDE_TORONTO_PATTERN =
  /\b(vancouver|montreal|ottawa|calgary|edmonton|mississauga|brampton|hamilton|london|ontario outside|new york|nyc|chicago|boston|seattle|san francisco|usa|united states|quebec city)\b/i;

function buildOutOfScopeResponse(threadId: string, messageId: string): CityCopilotResponse {
  return cityCopilotResponseSchema.parse({
    schemaVersion: 1,
    messageId,
    threadId,
    intent: ["SIMPLE_EXPLANATION"],
    answer: `${TORONTO_SCOPE_SHORT} I cannot plan for other cities or regions. Please ask about a Toronto neighbourhood, TTC corridor, Union schedule change, or downtown event.`,
    summary: "Rejected out-of-Toronto geography.",
    assumptions: [...TORONTO_SCOPE_ASSUMPTIONS],
    limitations: [...TORONTO_SCOPE_LIMITATIONS],
    mapActions: [],
    suggestedFollowUps: [
      "What is the best Toronto neighbourhood to add a subway station?",
      "What happens if the 4:06 departure at Union moves to 4:08?",
    ],
    startPlanningRun: false,
    scenarioId: null,
  });
}

function buildNavResponse(threadId: string, messageId: string, text: string): CityCopilotResponse {
  const matches = searchNeighbourhoods(text, undefined, 3);
  const rawActions =
    matches.length > 0
      ? [
          {
            type: "fly_to_center",
            center: matches[0].center,
            zoom: 14,
            durationMs: 1200,
          },
          {
            type: "highlight_neighbourhoods",
            neighbourhoodIds: matches.map((m) => m.id),
          },
          {
            type: "show_candidate_markers",
            candidates: matches.map((m, index) => ({
              candidateId: `station-${m.id}`,
              coordinates: m.center,
              rank: index + 1,
              label: m.name,
            })),
          },
        ]
      : [];
  const parsed = parseMapActions(rawActions);
  return cityCopilotResponseSchema.parse({
    schemaVersion: 1,
    messageId,
    threadId,
    intent: ["SIMPLE_MAP_NAVIGATION", "MAP_NAVIGATION"],
    answer:
      matches.length > 0
        ? `Showing ${matches.map((m) => m.name).join(", ")} on the map (synthetic neighbourhood fixtures).`
        : "I could not resolve a neighbourhood from that request.",
    summary: "Map navigation from City Copilot.",
    assumptions: [...TORONTO_SCOPE_ASSUMPTIONS, "Synthetic neighbourhood fixtures"],
    limitations: [...TORONTO_SCOPE_LIMITATIONS],
    mapActions: parsed.ok ? parsed.actions : [],
    suggestedFollowUps: [
      "What is the best neighbourhood to add a subway station?",
      "What happens if the 4:06 departure moves to 4:08?",
    ],
    startPlanningRun: false,
    scenarioId: null,
  });
}

function buildPlanningResponse(
  threadId: string,
  messageId: string,
  intent: string,
  bundle: string[],
): CityCopilotResponse {
  return cityCopilotResponseSchema.parse({
    schemaVersion: 1,
    messageId,
    threadId,
    intent: [intent],
    answer: `Intent classified as ${intent}. Activating ${bundle.length} specialist(s): ${bundle.join(", ")}. Starting a Backboard planning run on the flagship schedule scenario. Simulated evidence only.`,
    summary: "Kick off consolidated planning department run.",
    assumptions: [
      ...TORONTO_SCOPE_ASSUMPTIONS,
      "Flagship scenario departure-406-412 unless overridden",
      "Deterministic simulator is numerical authority",
    ],
    limitations: [
      ...TORONTO_SCOPE_LIMITATIONS,
      "Simulated citizen reactions are not real public consultation",
      "Synthetic fixture network, not live TTC GTFS",
    ],
    mapActions: [
      {
        type: "open_panel",
        panel: "evidence",
      },
    ],
    suggestedFollowUps: [
      "Compare the first and second choices",
      "How should service change after a concert at Scotiabank Arena?",
    ],
    startPlanningRun: true,
    scenarioId: FLAGSHIP_SCENARIO_ID,
  });
}

export async function getChatThread(threadId: string): Promise<ChatThreadRecord | null> {
  return loadThread(threadId);
}

export async function handleChatMessage(input: PostChatMessageInput): Promise<{
  thread: ChatThreadRecord;
  response: CityCopilotResponse;
}> {
  const threadId = input.threadId?.trim() || `chat-${randomUUID()}`;
  const existing = await loadThread(threadId);
  const createdAt = existing?.createdAt ?? nowIso();
  const recordedAt = nowIso();

  const userMessage: ChatMessageRecord = {
    messageId: `msg-${randomUUID()}`,
    role: "user",
    content: input.message,
    recordedAt,
  };

  const assistantMessageId = `msg-${randomUUID()}`;

  let response: CityCopilotResponse;
  let intent = classifyPlanningIntent(input.message);

  if (OUTSIDE_TORONTO_PATTERN.test(input.message)) {
    response = buildOutOfScopeResponse(threadId, assistantMessageId);
    intent = "SIMPLE_EXPLANATION";
  } else if (intent === "SIMPLE_MAP_NAVIGATION") {
    response = buildNavResponse(threadId, assistantMessageId, input.message);
  } else if (intent === "COMPARE_EXISTING_CANDIDATES" || intent === "SIMPLE_EXPLANATION") {
    response = cityCopilotResponseSchema.parse({
      schemaVersion: 1,
      messageId: assistantMessageId,
      threadId,
      intent: [intent],
      answer:
        intent === "COMPARE_EXISTING_CANDIDATES"
          ? "Reusing prior Toronto planning context when available. Open the Recommendation panel to compare ranked candidates from the latest Backboard run. Ask for a fresh Toronto schedule or station question to start a new simulation."
          : "I can explain ranked metrics and recommendations from the latest Toronto planning run. Simulated evidence only; the deterministic simulator remains numerical authority.",
      summary: intent === "COMPARE_EXISTING_CANDIDATES" ? "Compare existing candidates" : "Explain prior result",
      assumptions: [...TORONTO_SCOPE_ASSUMPTIONS, "Prior run context when present"],
      limitations: [
        ...TORONTO_SCOPE_LIMITATIONS,
        "Not a live TTC feed",
        "Simulated citizen reactions are not public consultation",
      ],
      mapActions: [{ type: "open_panel", panel: "policy_comparison" }],
      suggestedFollowUps: [
        "What happens if the 4:06 departure moves to 4:08?",
        "What is the best neighbourhood to add a subway station?",
      ],
      startPlanningRun: false,
      scenarioId: null,
    });
  } else {
    const bundle = selectAssistantsForIntent(intent);
    response = buildPlanningResponse(threadId, assistantMessageId, intent, bundle);
  }

  const assistantMessage: ChatMessageRecord = {
    messageId: assistantMessageId,
    role: "assistant",
    content: response.answer,
    recordedAt: nowIso(),
    intent,
    mapActions: response.mapActions,
    planningRunId: response.startPlanningRun ? FLAGSHIP_SCENARIO_ID : undefined,
  };

  const thread: ChatThreadRecord = {
    threadId,
    cityId: "toronto",
    status: "active",
    messages: [...(existing?.messages ?? []), userMessage, assistantMessage],
    createdAt,
    updatedAt: nowIso(),
  };

  await saveThread(thread);
  return { thread, response };
}

export async function createEmptyChatThread(): Promise<ChatThreadRecord> {
  const thread: ChatThreadRecord = {
    threadId: `chat-${randomUUID()}`,
    cityId: "toronto",
    status: "active",
    messages: [
      {
        messageId: `msg-${randomUUID()}`,
        role: "system",
        content: `City Copilot is ready. ${TORONTO_SCOPE_SHORT} Ask about Toronto neighbourhood station placement, the 4:06/4:12 Union schedule scenario, or concert service changes. Simulated planning only.`,
        recordedAt: nowIso(),
      },
    ],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await saveThread(thread);
  return thread;
}
