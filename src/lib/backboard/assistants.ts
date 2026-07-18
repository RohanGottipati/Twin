import type { MemoryMode, ThinkingConfig } from "@/lib/backboard/client";
import type { ModelRequirement } from "@/lib/backboard/model-router";
import { TOOL_NAMES, type ToolName } from "@/lib/backboard/tools";
import {
  KNOWLEDGE_BUNDLES,
  type KnowledgeDocumentRef,
} from "@/lib/backboard/knowledge-bundles";
import { TORONTO_SCOPE_AGENT_RULE } from "@/lib/twinto/toronto-scope";

/**
 * Canonical TwinTO Backboard roster: exactly 16 consolidated assistants.
 * Responsibilities from the former 54-specialist set are merged into these
 * roles; platform features (tools, RAG, memory, streaming) are preserved.
 */
export const TWINTO_ASSISTANT_KEYS = [
  "city-copilot",
  "planning-orchestrator",
  "demand-mobility-analyst",
  "transit-network-planner",
  "geospatial-planning-agent",
  "citizen-response-agent",
  "accessibility-equity-agent",
  "events-incidents-agent",
  "reliability-safety-agent",
  "cost-infrastructure-agent",
  "carbon-traffic-agent",
  "simulation-optimization-agent",
  "adversarial-reviewer",
  "evidence-auditor",
  "final-policy-judge",
  "explanation-map-action-agent",
] as const;

export type TwinTOAssistantKey = (typeof TWINTO_ASSISTANT_KEYS)[number];
/** @deprecated Prefer TwinTOAssistantKey; kept as the historical export name. */
export type AssistantRoleKey = TwinTOAssistantKey;

export type { KnowledgeDocumentRef };

export interface AssistantRoleDefinition {
  key: TwinTOAssistantKey;
  name: string;
  shortDescription: string;
  systemPrompt: string;
  toolNames: ToolName[];
  modelRequirement: ModelRequirement;
  thinking?: ThinkingConfig;
  memory: MemoryMode;
  knowledgeDocuments: KnowledgeDocumentRef[];
  uiGroup: "Conversation" | "Planning" | "Analysis" | "Validation" | "Decision";
}

export const MODEL_PROFILES = {
  FAST_CLASSIFICATION: { requireTools: true, requireJsonOutput: true },
  TOOL_ANALYSIS: { requireTools: true, requireJsonOutput: true },
  STRUCTURED_PLANNING: { requireTools: true, requireJsonOutput: true },
  RISK_REASONING: { requireTools: true, requireThinking: true, requireJsonOutput: true },
  SUMMARY: { requireJsonOutput: true },
  VISION_DOCUMENT: { requireTools: true, requireJsonOutput: true },
  VOICE_INTERFACE: { requireTools: true, requireJsonOutput: true },
} as const satisfies Record<string, ModelRequirement>;

export type PlanningIntent =
  | "SIMPLE_MAP_NAVIGATION"
  | "SIMPLE_EXPLANATION"
  | "NEW_STATION_LOCATION"
  | "SCHEDULE_CHANGE"
  | "EVENT_RESPONSE"
  | "COMPARE_EXISTING_CANDIDATES";

const SHARED_GUARD = `
You are part of TwinTO, a simulated Toronto transit planning environment.
You must use tool results for all factual and numerical claims.
You must never represent simulated citizen reactions as real public opinion.
You must never reveal private chain-of-thought.
You must state when data is synthetic or fixture-based.
You may propose or analyze policies, but deterministic simulation and hard
safety/accessibility checks determine whether a policy is viable.

${TORONTO_SCOPE_AGENT_RULE}
`.trim();

function docs(...bundles: (keyof typeof KNOWLEDGE_BUNDLES)[]): KnowledgeDocumentRef[] {
  const seen = new Set<string>();
  const out: KnowledgeDocumentRef[] = [];
  for (const bundle of bundles) {
    for (const doc of KNOWLEDGE_BUNDLES[bundle]) {
      if (seen.has(doc.filename)) continue;
      seen.add(doc.filename);
      out.push(doc);
    }
  }
  return out;
}

function role(
  partial: Omit<AssistantRoleDefinition, "systemPrompt"> & { promptBody: string },
): AssistantRoleDefinition {
  return {
    key: partial.key,
    name: partial.name,
    shortDescription: partial.shortDescription,
    systemPrompt: `${partial.promptBody.trim()}\n\n${SHARED_GUARD}`,
    toolNames: partial.toolNames,
    modelRequirement: partial.modelRequirement,
    thinking: partial.thinking,
    memory: partial.memory,
    knowledgeDocuments: partial.knowledgeDocuments,
    uiGroup: partial.uiGroup,
  };
}

export const ASSISTANT_ROSTER: Record<TwinTOAssistantKey, AssistantRoleDefinition> = {
  "city-copilot": role({
    key: "city-copilot",
    name: "TwinTO — City Copilot",
    shortDescription: "Persistent user-facing chat; classifies intents and preserves thread context.",
    uiGroup: "Conversation",
    memory: "Readonly",
    modelRequirement: MODEL_PROFILES.FAST_CLASSIFICATION,
    toolNames: [
      TOOL_NAMES.GET_CURRENT_MAP_CONTEXT,
      TOOL_NAMES.SEARCH_NEIGHBOURHOODS,
      TOOL_NAMES.RETRIEVE_DOCUMENTS,
      TOOL_NAMES.COMPOSE_MAP_ACTIONS,
    ],
    knowledgeDocuments: docs("GENERAL_TRANSIT"),
    promptBody: `
You are the TwinTO City Copilot. You own the persistent user-facing chat thread
on the Toronto map. Classify each message as a planning intent, read current
map context, resolve follow-ups such as "the second option" or "this
neighbourhood", and hand complex planning to the Planning Orchestrator. Never
perform unsupported numerical analysis yourself; stream grounded answers that
cite tool and specialist evidence. If the user asks about any place outside
the City of Toronto, say clearly that TwinTO only covers Toronto and ask them
to reframe the question inside Toronto.
`.trim(),
  }),

  "planning-orchestrator": role({
    key: "planning-orchestrator",
    name: "TwinTO — Planning Orchestrator",
    shortDescription: "Decomposes requests, selects specialist bundles, and coordinates parallel work.",
    uiGroup: "Planning",
    memory: "Readonly",
    modelRequirement: MODEL_PROFILES.TOOL_ANALYSIS,
    thinking: { effort: "medium" },
    toolNames: [
      TOOL_NAMES.GET_CURRENT_MAP_CONTEXT,
      TOOL_NAMES.GET_NETWORK_SNAPSHOT,
      TOOL_NAMES.FIND_SIMILAR,
      TOOL_NAMES.RETRIEVE_DOCUMENTS,
      TOOL_NAMES.SAVE_ITERATION,
    ],
    knowledgeDocuments: docs("GENERAL_TRANSIT", "PLANNING"),
    promptBody: `
You are the TwinTO Planning Orchestrator. Convert the user request into a
planning workflow, state explicit assumptions when needed, select the relevant
specialist bundle, run independent specialists in parallel, coordinate chained
tool rounds, request revisions when evidence is incomplete, and send completed
evidence packs to the Final Policy Judge.
`.trim(),
  }),

  "demand-mobility-analyst": role({
    key: "demand-mobility-analyst",
    name: "TwinTO — Demand and Mobility Analyst",
    shortDescription: "Arrivals, OD flows, peaks, latent demand, waiting, shift and night mobility.",
    uiGroup: "Analysis",
    memory: "Readonly",
    modelRequirement: MODEL_PROFILES.TOOL_ANALYSIS,
    toolNames: [
      TOOL_NAMES.GET_PASSENGER_ARRIVALS,
      TOOL_NAMES.GET_OD_FLOWS,
      TOOL_NAMES.GET_DEPARTURE_LOADS,
      TOOL_NAMES.GET_TRANSFER_DEMAND,
      TOOL_NAMES.GET_DEMOGRAPHICS,
      TOOL_NAMES.GET_POPULATION_EMPLOYMENT_GROWTH,
      TOOL_NAMES.CALCULATE_WAIT,
    ],
    knowledgeDocuments: docs("GENERAL_TRANSIT", "PLANNING"),
    promptBody: `
You analyze passenger demand and mobility: arrivals, origin-destination flows,
peak periods, underserved demand, schedule flexibility, waiting behaviour,
shift-worker and late-night demand, and car-to-transit potential. Report only
tool-backed patterns and label fixture data.
`.trim(),
  }),

  "transit-network-planner": role({
    key: "transit-network-planner",
    name: "TwinTO — Transit Network Planner",
    shortDescription: "Subway, streetcar, and bus schedule and route candidates.",
    uiGroup: "Planning",
    memory: "Readonly",
    modelRequirement: MODEL_PROFILES.STRUCTURED_PLANNING,
    toolNames: [
      TOOL_NAMES.GET_NETWORK_SNAPSHOT,
      TOOL_NAMES.GET_ROUTE_SCHEDULE,
      TOOL_NAMES.GET_VEHICLE_CAPACITY,
      TOOL_NAMES.GET_FLEET_AVAILABILITY,
      TOOL_NAMES.PROPOSE_VARIANTS,
      TOOL_NAMES.GENERATE_STATION_CANDIDATES,
      TOOL_NAMES.FIND_SIMILAR,
    ],
    knowledgeDocuments: docs("GENERAL_TRANSIT", "PLANNING"),
    promptBody: `
You plan subway, streetcar, and bus service changes: frequency, retiming, route
extensions, new routes, transfer coordination, signal-priority concepts, and
journey continuity. Generate multiple structured candidate policies; never
declare a final winner.
`.trim(),
  }),

  "geospatial-planning-agent": role({
    key: "geospatial-planning-agent",
    name: "TwinTO — Geospatial Planning Agent",
    shortDescription: "Map context, neighbourhood search, station placement geometry.",
    uiGroup: "Planning",
    memory: "Readonly",
    modelRequirement: MODEL_PROFILES.TOOL_ANALYSIS,
    toolNames: [
      TOOL_NAMES.GET_CURRENT_MAP_CONTEXT,
      TOOL_NAMES.SEARCH_NEIGHBOURHOODS,
      TOOL_NAMES.GET_LAND_USE_CONTEXT,
      TOOL_NAMES.GET_TRANSIT_ACCESSIBILITY,
      TOOL_NAMES.GENERATE_STATION_CANDIDATES,
      TOOL_NAMES.COMPOSE_MAP_ACTIONS,
    ],
    knowledgeDocuments: docs("GENERAL_TRANSIT", "PLANNING"),
    promptBody: `
You interpret the active map viewport and selected features, search
neighbourhoods and corridors, generate bounded candidate areas and station
coordinates with catchments, and validate that geographic claims come from
known geometry. Every candidate coordinate must be inside the City of Toronto.
Never propose stations, routes, or catchments outside Toronto. Never choose
the final winner.
`.trim(),
  }),

  "citizen-response-agent": role({
    key: "citizen-response-agent",
    name: "TwinTO — Citizen Response Agent",
    shortDescription: "Calls the citizen-reaction provider and aggregates simulated opinions.",
    uiGroup: "Analysis",
    memory: "Readonly",
    modelRequirement: MODEL_PROFILES.TOOL_ANALYSIS,
    toolNames: [
      TOOL_NAMES.CALL_CITIZEN_MODEL,
      TOOL_NAMES.AGGREGATE_REACTIONS,
      TOOL_NAMES.GET_DEMOGRAPHICS,
    ],
    knowledgeDocuments: docs("GENERAL_TRANSIT", "CITIZEN_MODEL"),
    promptBody: `
You call FreeSolo CitizenReactionLM or the active mock provider, batch weighted
cohorts, aggregate mode/schedule/opinion changes, and report uncertainty.
Always label reactions as simulated. Never call them real public consultation.
`.trim(),
  }),

  "accessibility-equity-agent": role({
    key: "accessibility-equity-agent",
    name: "TwinTO — Accessibility and Equity Agent",
    shortDescription: "Accessibility constraints, equity gaps, and hard access guardrails.",
    uiGroup: "Analysis",
    memory: "Readonly",
    modelRequirement: MODEL_PROFILES.RISK_REASONING,
    thinking: { effort: "high" },
    toolNames: [
      TOOL_NAMES.GET_ACCESSIBILITY,
      TOOL_NAMES.GET_TRANSIT_ACCESSIBILITY,
      TOOL_NAMES.GET_DEMOGRAPHICS,
      TOOL_NAMES.CALCULATE_ACCESSIBILITY,
      TOOL_NAMES.CALCULATE_EQUITY,
    ],
    knowledgeDocuments: docs("GENERAL_TRANSIT", "ACCESSIBILITY_EQUITY"),
    promptBody: `
You evaluate accessibility constraints, mobility-needs impacts, and the
distribution of benefits and harms across income, neighbourhood, age, and work
schedules. Reject recommendations that violate hard accessibility rules.
`.trim(),
  }),

  "events-incidents-agent": role({
    key: "events-incidents-agent",
    name: "TwinTO — Events and Incident Agent",
    shortDescription: "Concerts, weather, closures, construction, and emergency reroutes.",
    uiGroup: "Analysis",
    memory: "Readonly",
    modelRequirement: MODEL_PROFILES.TOOL_ANALYSIS,
    toolNames: [
      TOOL_NAMES.GET_EVENT_CONTEXT,
      TOOL_NAMES.GET_WEATHER_CONTEXT,
      TOOL_NAMES.GET_INCIDENTS,
      TOOL_NAMES.GET_NETWORK_SNAPSHOT,
    ],
    knowledgeDocuments: docs("GENERAL_TRANSIT", "SAFETY_RELIABILITY"),
    promptBody: `
You analyze concerts and sporting events, weather, closures, construction,
disabled vehicles, service suspensions, temporary demand surges, and emergency
rerouting. Optional public web context is allowed only when enabled; still
prefer tool and fixture evidence for numbers.
`.trim(),
  }),

  "reliability-safety-agent": role({
    key: "reliability-safety-agent",
    name: "TwinTO — Reliability and Safety Agent",
    shortDescription: "Crowding, capacity, bunching, delays, and hard safety constraints.",
    uiGroup: "Validation",
    memory: "Readonly",
    modelRequirement: MODEL_PROFILES.RISK_REASONING,
    thinking: { effort: "high" },
    toolNames: [
      TOOL_NAMES.GET_STOP_CROWDING,
      TOOL_NAMES.GET_VEHICLE_CAPACITY,
      TOOL_NAMES.GET_FLEET_AVAILABILITY,
      TOOL_NAMES.GET_DELAY_HISTORY,
      TOOL_NAMES.CALCULATE_LOAD,
      TOOL_NAMES.CALCULATE_RELIABILITY,
      TOOL_NAMES.STRESS_TEST,
    ],
    knowledgeDocuments: docs("GENERAL_TRANSIT", "SAFETY_RELIABILITY"),
    promptBody: `
You assess platform and vehicle crowding, capacity, headway reliability,
bunching, delay propagation, and fleet feasibility. Enforce hard simulated
safety constraints and reject unsafe candidates regardless of other benefits.
`.trim(),
  }),

  "cost-infrastructure-agent": role({
    key: "cost-infrastructure-agent",
    name: "TwinTO — Cost and Infrastructure Agent",
    shortDescription: "Operating cost, infrastructure feasibility, and productivity proxies.",
    uiGroup: "Analysis",
    memory: "Readonly",
    modelRequirement: MODEL_PROFILES.TOOL_ANALYSIS,
    toolNames: [
      TOOL_NAMES.CALCULATE_COST,
      TOOL_NAMES.GET_FLEET_AVAILABILITY,
      TOOL_NAMES.GET_LAND_USE_CONTEXT,
      TOOL_NAMES.FIND_SIMILAR,
    ],
    knowledgeDocuments: docs("GENERAL_TRANSIT", "IMPACT"),
    promptBody: `
You estimate operating-cost proxies, vehicle and operator requirements,
construction and right-of-way feasibility, infrastructure complexity, and
travel-time productivity value. Distinguish short-term and long-term
feasibility; never invent capital budgets.
`.trim(),
  }),

  "carbon-traffic-agent": role({
    key: "carbon-traffic-agent",
    name: "TwinTO — Carbon and Traffic Agent",
    shortDescription: "Car-trip shifts, congestion proxies, and transport emissions estimates.",
    uiGroup: "Analysis",
    memory: "Readonly",
    modelRequirement: MODEL_PROFILES.TOOL_ANALYSIS,
    toolNames: [TOOL_NAMES.CALCULATE_CARBON, TOOL_NAMES.GET_OD_FLOWS, TOOL_NAMES.GET_LAND_USE_CONTEXT],
    knowledgeDocuments: docs("GENERAL_TRANSIT", "IMPACT"),
    promptBody: `
You estimate car-trip changes, road congestion proxies, vehicle kilometres, and
transport emissions. State carbon assumptions and limitations clearly; fixture
estimates are not live inventories.
`.trim(),
  }),

  "simulation-optimization-agent": role({
    key: "simulation-optimization-agent",
    name: "TwinTO — Simulation and Optimization Agent",
    shortDescription: "Runs the deterministic simulator and compares baseline vs candidates.",
    uiGroup: "Validation",
    memory: "Readonly",
    modelRequirement: MODEL_PROFILES.TOOL_ANALYSIS,
    toolNames: [
      TOOL_NAMES.RUN_SIMULATION,
      TOOL_NAMES.SIMULATE_STATION_CANDIDATE,
      TOOL_NAMES.CALCULATE_WAIT,
      TOOL_NAMES.CALCULATE_LOAD,
      TOOL_NAMES.COMPARE_POLICIES,
    ],
    knowledgeDocuments: docs("GENERAL_TRANSIT", "PLANNING"),
    promptBody: `
You call the deterministic transit simulator, build reproducible scenarios,
compare baseline and candidate metrics, and validate simulator versions and
seeds. Language-model opinion must never replace simulator results.
`.trim(),
  }),

  "adversarial-reviewer": role({
    key: "adversarial-reviewer",
    name: "TwinTO — Adversarial Reviewer",
    shortDescription: "Stress-tests leaders, counterfactuals, and hidden harms. Memory off.",
    uiGroup: "Validation",
    memory: "off",
    modelRequirement: MODEL_PROFILES.RISK_REASONING,
    thinking: { effort: "high" },
    toolNames: [
      TOOL_NAMES.STRESS_TEST,
      TOOL_NAMES.COMPARE_POLICIES,
      TOOL_NAMES.PROPOSE_VARIANTS,
      TOOL_NAMES.RUN_SIMULATION,
    ],
    knowledgeDocuments: docs("GENERAL_TRANSIT", "SAFETY_RELIABILITY", "PLANNING"),
    promptBody: `
You challenge the leading proposal, test a no-change counterfactual, propose a
materially different alternative, inject combined failures, and look for
displaced congestion and hidden harms. Memory is off for adversarial runs.
`.trim(),
  }),

  "evidence-auditor": role({
    key: "evidence-auditor",
    name: "TwinTO — Evidence Auditor",
    shortDescription: "Provenance, citations, fixture labeling, and metric consistency checks.",
    uiGroup: "Validation",
    memory: "Readonly",
    modelRequirement: MODEL_PROFILES.RISK_REASONING,
    thinking: { effort: "high" },
    toolNames: [
      TOOL_NAMES.RETRIEVE_DOCUMENTS,
      TOOL_NAMES.COMPARE_POLICIES,
      TOOL_NAMES.GET_NETWORK_SNAPSHOT,
    ],
    knowledgeDocuments: docs("GENERAL_TRANSIT", "PLANNING"),
    promptBody: `
You check that every factual and numerical conclusion comes from tools,
documents, repository data, citizen-provider output, or simulator output.
Confirm provenance, identify synthetic/fixture data, verify citations, and
reject unsupported conclusions. Confirm the recommended candidate matches the
metrics.
`.trim(),
  }),

  "final-policy-judge": role({
    key: "final-policy-judge",
    name: "TwinTO — Final Policy Judge",
    shortDescription: "Ranks validated candidates under hard constraints; never invents metrics.",
    uiGroup: "Decision",
    memory: "Readonly",
    modelRequirement: MODEL_PROFILES.RISK_REASONING,
    thinking: { effort: "high" },
    toolNames: [TOOL_NAMES.COMPARE_POLICIES, TOOL_NAMES.RETRIEVE_DOCUMENTS],
    knowledgeDocuments: docs("GENERAL_TRANSIT", "PLANNING", "ACCESSIBILITY_EQUITY", "SAFETY_RELIABILITY"),
    promptBody: `
You compare all validated candidates across safety, reliability, accessibility,
equity, demand, feasibility, cost, carbon, and citizen reactions. Respect
deterministic hard constraints. Return recommend, recommend_with_conditions,
compare_only, insufficient_evidence, or reject_all. Preserve meaningful
disagreement. Never invent metrics.
`.trim(),
  }),

  "explanation-map-action-agent": role({
    key: "explanation-map-action-agent",
    name: "TwinTO — Explanation and Map Action Agent",
    shortDescription: "Final chat explanation, map actions, follow-ups, and approved memory writes.",
    uiGroup: "Conversation",
    memory: "Readonly",
    modelRequirement: MODEL_PROFILES.SUMMARY,
    toolNames: [
      TOOL_NAMES.COMPOSE_MAP_ACTIONS,
      TOOL_NAMES.RETRIEVE_DOCUMENTS,
      TOOL_NAMES.WRITE_MEMORY,
      TOOL_NAMES.CREATE_TRAINING,
    ],
    knowledgeDocuments: docs("GENERAL_TRANSIT", "CITIZEN_MODEL"),
    promptBody: `
You produce the final chat explanation, technical and concise summary variants,
safe allowlisted map actions, and suggested follow-ups. Label simulated
opinions. Every map action coordinate must be inside the City of Toronto;
never emit fly_to, markers, or highlights outside Toronto. Write approved
memory only after explicit user confirmation. Mark eligible runs for training
curation. Never expose raw chain-of-thought.
`.trim(),
  }),
};

export const ASSISTANT_UI_GROUPS = {
  Conversation: ["city-copilot", "explanation-map-action-agent"],
  Planning: ["planning-orchestrator", "transit-network-planner", "geospatial-planning-agent"],
  Analysis: [
    "demand-mobility-analyst",
    "citizen-response-agent",
    "accessibility-equity-agent",
    "events-incidents-agent",
    "cost-infrastructure-agent",
    "carbon-traffic-agent",
  ],
  Validation: [
    "reliability-safety-agent",
    "simulation-optimization-agent",
    "adversarial-reviewer",
    "evidence-auditor",
  ],
  Decision: ["final-policy-judge"],
} as const satisfies Record<string, readonly TwinTOAssistantKey[]>;

export const INTENT_BUNDLES: Record<PlanningIntent, readonly TwinTOAssistantKey[]> = {
  SIMPLE_MAP_NAVIGATION: ["city-copilot", "geospatial-planning-agent", "explanation-map-action-agent"],
  SIMPLE_EXPLANATION: ["city-copilot", "evidence-auditor", "explanation-map-action-agent"],
  NEW_STATION_LOCATION: [
    "city-copilot",
    "planning-orchestrator",
    "demand-mobility-analyst",
    "transit-network-planner",
    "geospatial-planning-agent",
    "citizen-response-agent",
    "accessibility-equity-agent",
    "reliability-safety-agent",
    "cost-infrastructure-agent",
    "carbon-traffic-agent",
    "simulation-optimization-agent",
    "adversarial-reviewer",
    "evidence-auditor",
    "final-policy-judge",
    "explanation-map-action-agent",
  ],
  SCHEDULE_CHANGE: [
    "city-copilot",
    "planning-orchestrator",
    "demand-mobility-analyst",
    "transit-network-planner",
    "citizen-response-agent",
    "accessibility-equity-agent",
    "reliability-safety-agent",
    "cost-infrastructure-agent",
    "simulation-optimization-agent",
    "adversarial-reviewer",
    "evidence-auditor",
    "final-policy-judge",
    "explanation-map-action-agent",
  ],
  EVENT_RESPONSE: [
    "city-copilot",
    "planning-orchestrator",
    "demand-mobility-analyst",
    "transit-network-planner",
    "geospatial-planning-agent",
    "citizen-response-agent",
    "accessibility-equity-agent",
    "events-incidents-agent",
    "reliability-safety-agent",
    "cost-infrastructure-agent",
    "carbon-traffic-agent",
    "simulation-optimization-agent",
    "adversarial-reviewer",
    "evidence-auditor",
    "final-policy-judge",
    "explanation-map-action-agent",
  ],
  COMPARE_EXISTING_CANDIDATES: [
    "city-copilot",
    "simulation-optimization-agent",
    "evidence-auditor",
    "final-policy-judge",
    "explanation-map-action-agent",
  ],
};

export function selectAssistantsForIntent(
  intent: PlanningIntent,
  options?: { includeEvents?: boolean },
): TwinTOAssistantKey[] {
  const keys = new Set<TwinTOAssistantKey>(INTENT_BUNDLES[intent]);
  if (options?.includeEvents && intent === "NEW_STATION_LOCATION") {
    keys.add("events-incidents-agent");
  }
  return Array.from(keys);
}

/**
 * Scenario adapter for the flagship schedule demo. Prefer
 * selectAssistantsForIntent for chat-driven runs.
 */
export function selectAssistantBundle(
  scenarioId: string,
  options?: { includeConcert?: boolean; includeWeather?: boolean },
): TwinTOAssistantKey[] {
  const includeEvents =
    options?.includeConcert === true ||
    options?.includeWeather === true ||
    scenarioId === "departure-406-412";
  if (includeEvents && scenarioId === "departure-406-412") {
    return selectAssistantsForIntent("EVENT_RESPONSE");
  }
  if (scenarioId === "departure-406-412") {
    return selectAssistantsForIntent("SCHEDULE_CHANGE", { includeEvents });
  }
  return selectAssistantsForIntent("SCHEDULE_CHANGE", { includeEvents });
}

/** @deprecated Use INTENT_BUNDLES.SCHEDULE_CHANGE / EVENT_RESPONSE instead. */
export const CORE_SCHEDULE_BUNDLE = INTENT_BUNDLES.SCHEDULE_CHANGE;
/** @deprecated Use INTENT_BUNDLES.EVENT_RESPONSE instead. */
export const CONCERT_BUNDLE = ["events-incidents-agent"] as const;
/** @deprecated Use INTENT_BUNDLES.EVENT_RESPONSE instead. */
export const WEATHER_BUNDLE = ["events-incidents-agent"] as const;

export function listAssistantRoles(): AssistantRoleDefinition[] {
  return TWINTO_ASSISTANT_KEYS.map((key) => ASSISTANT_ROSTER[key]);
}

export function getAssistantRole(key: TwinTOAssistantKey): AssistantRoleDefinition {
  return ASSISTANT_ROSTER[key];
}

export function isTwinTOAssistantKey(value: string): value is TwinTOAssistantKey {
  return (TWINTO_ASSISTANT_KEYS as readonly string[]).includes(value);
}
