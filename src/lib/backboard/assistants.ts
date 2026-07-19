import type { MemoryMode, ThinkingConfig } from "@/lib/backboard/client";
import type { ModelRequirement } from "@/lib/backboard/model-router";
import { TOOL_NAMES, type ToolName } from "@/lib/backboard/tools";
import {
  KNOWLEDGE_BUNDLES,
  type KnowledgeDocumentRef,
} from "@/lib/backboard/knowledge-bundles";
import { TORONTO_SCOPE_AGENT_RULE } from "@/lib/twinto/toronto-scope";

/**
 * Principled city-planning roster (~11). Competence lives in tools + twin;
 * no niche one-use-case agents (no NuclearSitingAgent, no schedule-only roles).
 */
export const TWINTO_ASSISTANT_KEYS = [
  "city-copilot",
  "planning-orchestrator",
  "geospatial-twin",
  "scenario-designer",
  "citizen-response",
  "equity-impact",
  "feasibility",
  "adversarial-reviewer",
  "evidence-auditor",
  "final-policy-judge",
  "explanation-map",
] as const;

export type TwinTOAssistantKey = (typeof TWINTO_ASSISTANT_KEYS)[number];
/** @deprecated Prefer TwinTOAssistantKey */
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
  | "COMPARE_EXISTING_CANDIDATES"
  | "OPEN_CITY_ASK";

const SHARED_GUARD = `
You are part of ToronTwin / TwinTO, a Toronto city planning sandbox on Backboard.
You must use tool results for all factual and numerical claims.
You must never represent simulated citizen reactions as real public opinion.
You must never reveal private chain-of-thought.
You must state when data is synthetic or fixture-based.
Day-one acceptance is not a ridership or economic forecast.
You may propose ScenarioPatches via general twin verbs (query/patch/run); never
invent niche tools like add_nuclear_plant.

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
    name: "ToronTwin — City Copilot",
    shortDescription: "Front-door chat; intent handoff to the planning department.",
    uiGroup: "Conversation",
    memory: "Readonly",
    modelRequirement: MODEL_PROFILES.FAST_CLASSIFICATION,
    toolNames: [
      TOOL_NAMES.GET_CURRENT_MAP_CONTEXT,
      TOOL_NAMES.QUERY_CITY_LAYER,
      TOOL_NAMES.SEARCH_NEIGHBOURHOODS,
      TOOL_NAMES.QUERY_TWIN,
      TOOL_NAMES.RETRIEVE_DOCUMENTS,
      TOOL_NAMES.COMPOSE_MAP_ACTIONS,
    ],
    knowledgeDocuments: docs("GENERAL_TRANSIT"),
    promptBody: `
You are the City Copilot. Own the user-facing chat on the Toronto map. Classify
intents (navigation, explanation, or open city ask), resolve follow-ups, and
hand complex planning to the Planning Orchestrator. Never invent numeric
acceptance yourself; cite tools and specialists. Keep replies short.
`.trim(),
  }),

  "planning-orchestrator": role({
    key: "planning-orchestrator",
    name: "ToronTwin — Planning Orchestrator",
    shortDescription: "Unopinionated coordinator agent: tools over fixed city workflows.",
    uiGroup: "Planning",
    memory: "Readonly",
    modelRequirement: MODEL_PROFILES.TOOL_ANALYSIS,
    thinking: { effort: "medium" },
    toolNames: [
      TOOL_NAMES.GET_CURRENT_MAP_CONTEXT,
      TOOL_NAMES.QUERY_CITY_LAYER,
      TOOL_NAMES.SEARCH_NEIGHBOURHOODS,
      TOOL_NAMES.QUERY_TWIN,
      TOOL_NAMES.PATCH_TWIN,
      TOOL_NAMES.SNAPSHOT_TWIN,
      TOOL_NAMES.DIFF_TWIN,
      TOOL_NAMES.PROPOSE_SCENARIOS,
      TOOL_NAMES.SCORE_POPULATION,
      TOOL_NAMES.RUN_TWIN_ANALYSIS,
      TOOL_NAMES.INVOKE_ASSISTANT,
      TOOL_NAMES.RETRIEVE_DOCUMENTS,
      TOOL_NAMES.COMPOSE_MAP_ACTIONS,
      TOOL_NAMES.RUN_PYTHON,
    ],
    knowledgeDocuments: docs("GENERAL_TRANSIT", "PLANNING"),
    promptBody: `
You are City Code, ToronTwin's Planning Orchestrator: a free-form colleague for
Toronto city planning, analogous to Claude Code for a city twin.

You have real agency. You may ask clarifying questions, refuse a bad framing,
offer 2-3 interpretations, call tools, draw on the map, or answer directly.
Vague asks like "best neighbourhood" deserve clarification (best for what:
access gap, equity, density, cost, political feasibility?) before a ranking.

You have general tools (query/patch/snapshot/diff twin, propose_scenarios,
score_population, invoke_assistant, compose_map_actions, run_python, map
helpers). Tools are optional; never tool-spam to look busy.

Use compose_map_actions to focus the map, highlight neighbourhoods, draw
points/lines/polygons, and annotate so the user can see your reasoning.
Drawing that collides with an existing overlay returns an error; move or
remove first.

Use run_python when you need to query Mongo (read-only db), crunch tables
(pandas/numpy/scipy/statsmodels/sklearn), or test a quantitative hypothesis.
Assign RESULT for a dataframe preview. Toronto data only.

Do not invent ScenarioPatches or rankings when tools are not useful. When you
do score acceptance, it is simulated day-one feel, never ridership or real
public opinion.

Prefer query_city_layer / search_neighbourhoods (official Toronto open data)
over any synthetic TwinTO fixtures. When proposing options, use real
neighbourhood names as human-readable titles (e.g. "New station in Alderwood");
never expose internal slug ids like "station-alderwood" to the user.

Keep replies short. If clarifying, ask 1-3 pointed questions and wait.
`.trim(),
  }),

  "geospatial-twin": role({
    key: "geospatial-twin",
    name: "ToronTwin — Geospatial Twin",
    shortDescription: "Query/patch city geometry, land use, networks via twin verbs.",
    uiGroup: "Planning",
    memory: "Readonly",
    modelRequirement: MODEL_PROFILES.TOOL_ANALYSIS,
    toolNames: [
      TOOL_NAMES.GET_CURRENT_MAP_CONTEXT,
      TOOL_NAMES.QUERY_CITY_LAYER,
      TOOL_NAMES.SEARCH_NEIGHBOURHOODS,
      TOOL_NAMES.QUERY_TWIN,
      TOOL_NAMES.PATCH_TWIN,
      TOOL_NAMES.SNAPSHOT_TWIN,
      TOOL_NAMES.DIFF_TWIN,
      TOOL_NAMES.GET_LAND_USE_CONTEXT,
      TOOL_NAMES.GET_NETWORK_SNAPSHOT,
      TOOL_NAMES.GENERATE_STATION_CANDIDATES,
      TOOL_NAMES.COMPOSE_MAP_ACTIONS,
    ],
    knowledgeDocuments: docs("GENERAL_TRANSIT", "PLANNING"),
    promptBody: `
You operate the city twin: query and patch geometry, land use, corridors, and
POIs. Every coordinate must be inside Toronto. Use general edit kinds
(add_poi, close_route, add_corridor, set_policy, set_land_use). Never pick the
final winner.
`.trim(),
  }),

  "scenario-designer": role({
    key: "scenario-designer",
    name: "ToronTwin — Scenario Designer",
    shortDescription: "Proposes N general ScenarioPatches for any city ask.",
    uiGroup: "Planning",
    memory: "Readonly",
    modelRequirement: MODEL_PROFILES.STRUCTURED_PLANNING,
    toolNames: [
      TOOL_NAMES.PROPOSE_SCENARIOS,
      TOOL_NAMES.PATCH_TWIN,
      TOOL_NAMES.QUERY_TWIN,
      TOOL_NAMES.GET_NETWORK_SNAPSHOT,
      TOOL_NAMES.PROPOSE_VARIANTS,
      TOOL_NAMES.GENERATE_STATION_CANDIDATES,
      TOOL_NAMES.FIND_SIMILAR,
    ],
    knowledgeDocuments: docs("GENERAL_TRANSIT", "PLANNING"),
    promptBody: `
You design multiple ScenarioPatches for the user ask: stations, stadiums,
energy sites, corridor changes, policy levers. Always propose 2+ alternatives
plus a counterfactual when useful. Never declare the final winner.
`.trim(),
  }),

  "citizen-response": role({
    key: "citizen-response",
    name: "ToronTwin — Citizen Response",
    shortDescription: "Scores census-weighted population acceptance for patches.",
    uiGroup: "Analysis",
    memory: "Readonly",
    modelRequirement: MODEL_PROFILES.TOOL_ANALYSIS,
    toolNames: [
      TOOL_NAMES.SCORE_POPULATION,
      TOOL_NAMES.CALL_CITIZEN_MODEL,
      TOOL_NAMES.AGGREGATE_REACTIONS,
      TOOL_NAMES.GET_DEMOGRAPHICS,
    ],
    knowledgeDocuments: docs("GENERAL_TRANSIT", "CITIZEN_MODEL"),
    promptBody: `
You score day-one acceptance via score_population / citizen-reaction tools.
Always label outputs as simulated. Never call them real consultation. Opinions
are the audit trail; scores are readouts.
`.trim(),
  }),

  "equity-impact": role({
    key: "equity-impact",
    name: "ToronTwin — Equity Impact",
    shortDescription: "Who wins/loses across neighbourhoods and groups for any policy.",
    uiGroup: "Analysis",
    memory: "Readonly",
    modelRequirement: MODEL_PROFILES.RISK_REASONING,
    thinking: { effort: "high" },
    toolNames: [
      TOOL_NAMES.GET_ACCESSIBILITY,
      TOOL_NAMES.GET_DEMOGRAPHICS,
      TOOL_NAMES.CALCULATE_ACCESSIBILITY,
      TOOL_NAMES.CALCULATE_EQUITY,
      TOOL_NAMES.SCORE_POPULATION,
      TOOL_NAMES.QUERY_TWIN,
      TOOL_NAMES.RUN_PYTHON,
    ],
    knowledgeDocuments: docs("GENERAL_TRANSIT", "ACCESSIBILITY_EQUITY"),
    promptBody: `
You evaluate distributional impacts of any ScenarioPatch: income, neighbourhood,
age, accessibility. Flag inequitable concentrations of harm. Use run_python for
tabular / statistical checks against Mongo or TWIN when helpful.
`.trim(),
  }),

  feasibility: role({
    key: "feasibility",
    name: "ToronTwin — Feasibility",
    shortDescription: "Cost, infra, safety, carbon, ops constraints for any proposal.",
    uiGroup: "Analysis",
    memory: "Readonly",
    modelRequirement: MODEL_PROFILES.TOOL_ANALYSIS,
    toolNames: [
      TOOL_NAMES.CALCULATE_COST,
      TOOL_NAMES.CALCULATE_CARBON,
      TOOL_NAMES.CALCULATE_RELIABILITY,
      TOOL_NAMES.CALCULATE_LOAD,
      TOOL_NAMES.GET_FLEET_AVAILABILITY,
      TOOL_NAMES.GET_LAND_USE_CONTEXT,
      TOOL_NAMES.GET_EVENT_CONTEXT,
      TOOL_NAMES.RUN_TWIN_ANALYSIS,
      TOOL_NAMES.STRESS_TEST,
      TOOL_NAMES.RUN_SIMULATION,
      TOOL_NAMES.RUN_PYTHON,
    ],
    knowledgeDocuments: docs("GENERAL_TRANSIT", "IMPACT", "SAFETY_RELIABILITY"),
    promptBody: `
You assess feasibility: cost, infrastructure, safety, carbon, and operational
stress for any city patch. Call transit metric tools only when the ask needs
them; they are tools, not your identity. Use run_python for quantitative
hypotheses (read-only Mongo + scientific Python stack).
`.trim(),
  }),

  "adversarial-reviewer": role({
    key: "adversarial-reviewer",
    name: "ToronTwin — Adversarial Reviewer",
    shortDescription: "Attacks proposals; finds failure modes. Memory off.",
    uiGroup: "Validation",
    memory: "off",
    modelRequirement: MODEL_PROFILES.RISK_REASONING,
    thinking: { effort: "high" },
    toolNames: [
      TOOL_NAMES.STRESS_TEST,
      TOOL_NAMES.COMPARE_POLICIES,
      TOOL_NAMES.PROPOSE_SCENARIOS,
      TOOL_NAMES.DIFF_TWIN,
      TOOL_NAMES.SCORE_POPULATION,
    ],
    knowledgeDocuments: docs("GENERAL_TRANSIT", "SAFETY_RELIABILITY", "PLANNING"),
    promptBody: `
You challenge leading proposals, test no-change counterfactuals, and surface
hidden harms (including event/surge stress). Memory is off.
`.trim(),
  }),

  "evidence-auditor": role({
    key: "evidence-auditor",
    name: "ToronTwin — Evidence Auditor",
    shortDescription: "Audit trail: claims must cite twin/population tool outputs.",
    uiGroup: "Validation",
    memory: "Readonly",
    modelRequirement: MODEL_PROFILES.RISK_REASONING,
    thinking: { effort: "high" },
    toolNames: [
      TOOL_NAMES.RETRIEVE_DOCUMENTS,
      TOOL_NAMES.COMPARE_POLICIES,
      TOOL_NAMES.DIFF_TWIN,
      TOOL_NAMES.QUERY_TWIN,
      TOOL_NAMES.RUN_PYTHON,
    ],
    knowledgeDocuments: docs("GENERAL_TRANSIT", "PLANNING"),
    promptBody: `
You verify every factual claim traces to twin query/patch/diff, population
scores, documents, or run_python outputs. Reject unsupported conclusions.
`.trim(),
  }),

  "final-policy-judge": role({
    key: "final-policy-judge",
    name: "ToronTwin — Final Policy Judge",
    shortDescription: "Ranks validated ScenarioPatches; never invents metrics.",
    uiGroup: "Decision",
    memory: "Readonly",
    modelRequirement: MODEL_PROFILES.RISK_REASONING,
    thinking: { effort: "high" },
    toolNames: [TOOL_NAMES.COMPARE_POLICIES, TOOL_NAMES.SCORE_POPULATION, TOOL_NAMES.RETRIEVE_DOCUMENTS],
    knowledgeDocuments: docs("GENERAL_TRANSIT", "PLANNING", "ACCESSIBILITY_EQUITY", "SAFETY_RELIABILITY"),
    promptBody: `
You rank validated ScenarioPatches on acceptance, equity, and feasibility.
Return recommend, recommend_with_conditions, compare_only, insufficient_evidence,
or reject_all. Never invent metrics. Acceptance is not ridership.
`.trim(),
  }),

  "explanation-map": role({
    key: "explanation-map",
    name: "ToronTwin — Explanation and Map",
    shortDescription: "Plain-language explain + allowlisted map actions.",
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
You produce the final explanation and safe map actions. Label simulated
opinions. Coordinates must stay in Toronto.
`.trim(),
  }),
};

/** Same agents for every open city ask (station / stadium / nuclear / …). */
export const PRINCIPLED_CITY_BUNDLE: readonly TwinTOAssistantKey[] = [
  "city-copilot",
  "planning-orchestrator",
  "geospatial-twin",
  "scenario-designer",
  "citizen-response",
  "equity-impact",
  "feasibility",
  "adversarial-reviewer",
  "evidence-auditor",
  "final-policy-judge",
  "explanation-map",
];

export const ASSISTANT_UI_GROUPS = {
  Conversation: ["city-copilot", "explanation-map"],
  Planning: ["planning-orchestrator", "geospatial-twin", "scenario-designer"],
  Analysis: ["citizen-response", "equity-impact", "feasibility"],
  Validation: ["adversarial-reviewer", "evidence-auditor"],
  Decision: ["final-policy-judge"],
} as const satisfies Record<string, readonly TwinTOAssistantKey[]>;

export const INTENT_BUNDLES: Record<PlanningIntent, readonly TwinTOAssistantKey[]> = {
  SIMPLE_MAP_NAVIGATION: ["city-copilot", "geospatial-twin", "explanation-map"],
  SIMPLE_EXPLANATION: ["city-copilot", "evidence-auditor", "explanation-map"],
  NEW_STATION_LOCATION: PRINCIPLED_CITY_BUNDLE,
  SCHEDULE_CHANGE: PRINCIPLED_CITY_BUNDLE,
  EVENT_RESPONSE: PRINCIPLED_CITY_BUNDLE,
  COMPARE_EXISTING_CANDIDATES: [
    "city-copilot",
    "feasibility",
    "evidence-auditor",
    "final-policy-judge",
    "explanation-map",
  ],
  OPEN_CITY_ASK: PRINCIPLED_CITY_BUNDLE,
};

export function selectAssistantsForIntent(
  intent: PlanningIntent,
  _options?: { includeEvents?: boolean },
): TwinTOAssistantKey[] {
  return Array.from(new Set(INTENT_BUNDLES[intent]));
}

export function selectAssistantBundle(
  scenarioId: string,
  options?: { includeConcert?: boolean; includeWeather?: boolean },
): TwinTOAssistantKey[] {
  const includeEvents =
    options?.includeConcert === true ||
    options?.includeWeather === true ||
    scenarioId === "departure-406-412";
  if (includeEvents) return selectAssistantsForIntent("EVENT_RESPONSE");
  if (scenarioId === "open-city" || scenarioId.startsWith("city:")) {
    return selectAssistantsForIntent("OPEN_CITY_ASK");
  }
  return selectAssistantsForIntent("SCHEDULE_CHANGE");
}

/** @deprecated */
export const CORE_SCHEDULE_BUNDLE = INTENT_BUNDLES.SCHEDULE_CHANGE;
/** @deprecated events folded into adversarial/feasibility */
export const CONCERT_BUNDLE = ["adversarial-reviewer"] as const;
/** @deprecated */
export const WEATHER_BUNDLE = ["feasibility"] as const;

export function listAssistantRoles(): AssistantRoleDefinition[] {
  return TWINTO_ASSISTANT_KEYS.map((key) => ASSISTANT_ROSTER[key]);
}

export function getAssistantRole(key: TwinTOAssistantKey): AssistantRoleDefinition {
  return ASSISTANT_ROSTER[key];
}

export function isTwinTOAssistantKey(value: string): value is TwinTOAssistantKey {
  return (TWINTO_ASSISTANT_KEYS as readonly string[]).includes(value);
}
