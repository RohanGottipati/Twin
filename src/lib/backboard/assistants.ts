import type { MemoryMode, ThinkingConfig } from "@/lib/backboard/client";
import type { ModelRequirement } from "@/lib/backboard/model-router";
import { TOOL_NAMES, type ToolName } from "@/lib/backboard/tools";
import {
  KNOWLEDGE_BUNDLES,
  type KnowledgeDocumentRef,
} from "@/lib/backboard/knowledge-bundles";
import { TORONTO_SCOPE_AGENT_RULE } from "@/lib/techto/toronto-scope";

/**
 * Principled city-planning roster (~11). Competence lives in tools + twin;
 * no niche one-use-case agents (no NuclearSitingAgent, no schedule-only roles).
 */
export const TECHTO_ASSISTANT_KEYS = [
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

export type TechTOAssistantKey = (typeof TECHTO_ASSISTANT_KEYS)[number];
/** @deprecated Prefer TechTOAssistantKey */
export type AssistantRoleKey = TechTOAssistantKey;

export type { KnowledgeDocumentRef };

export interface AssistantRoleDefinition {
  key: TechTOAssistantKey;
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
You are part of TechTO, a Toronto city planning sandbox on Backboard.
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

export const ASSISTANT_ROSTER: Record<TechTOAssistantKey, AssistantRoleDefinition> = {
  "city-copilot": role({
    key: "city-copilot",
    name: "TechTO — City Copilot",
    shortDescription: "Front-door chat; intent handoff to the planning department.",
    uiGroup: "Conversation",
    memory: "Readonly",
    modelRequirement: MODEL_PROFILES.FAST_CLASSIFICATION,
    toolNames: [
      TOOL_NAMES.GET_CURRENT_MAP_CONTEXT,
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
    name: "TechTO — Planning Orchestrator",
    shortDescription: "Unopinionated coordinator agent: tools over fixed city workflows.",
    uiGroup: "Planning",
    memory: "Readonly",
    modelRequirement: MODEL_PROFILES.TOOL_ANALYSIS,
    thinking: { effort: "medium" },
    toolNames: [
      TOOL_NAMES.GET_CURRENT_MAP_CONTEXT,
      TOOL_NAMES.SEARCH_NEIGHBOURHOODS,
      TOOL_NAMES.GENERATE_STATION_CANDIDATES,
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
You are TechTO's Planning Orchestrator: a free-form agent for Toronto city
planning, analogous to Claude Code for a city twin.

You have general tools (query/patch/snapshot/diff twin, propose_scenarios,
score_population, generate_station_candidates, invoke_assistant,
compose_map_actions, run_python, map helpers). Tools are optional; you choose
whether to talk, tool-call, or both. Prefer more tool rounds over a premature
answer when the user asks where to put something.

Siting / "where should we build" asks (stations, parks, facilities, etc.):
1. Screen several geographically distinct Toronto areas, not one guess. Prefer
   run_python (pandas on DATA_DIR/census_profile.csv or Mongo) for ranking /
   filtering; use search_neighbourhoods or generate_station_candidates for
   shortlists; use query_city_layer only for a named area or a tiny top-N
   (limit ≤ 3). Do not dump large open-data tables into the chat context.
2. Score day-one acceptance with score_population (or run_twin_analysis) on
   the leading options BEFORE you recommend. Pass neighbourhoodCodes for the
   specific candidate areas when you're comparing a short list -- only ask
   for an unscoped citywide read when you actually need overall city
   sentiment, since citywide sampling costs real model calls across every
   neighbourhood.
3. Sampling is adaptive: the tool keeps drawing residents until its
   confidence interval is tight (citywide.ciHalfWidth), not a fixed count.
   Check citywide.stopReason -- if it stopped at "max-sample" the CI may
   still be wide, so treat that mean as noisier and prefer rescoring or
   widening the sample before leaning on it for a close call.
4. Treat acceptance as a decision signal: if citywide mean/support is weak, or
   byNeighbourhood shows clear local opposition where you proposed, discard
   that site and try other neighbourhoods. Do not recommend a site you just
   scored as poorly accepted unless the user explicitly wants that tradeoff.
5. Iterate: revise candidates, rescore, and only then lock a recommendation.
   You are allowed many tool rounds for this; stopping after one weak score is
   a failure mode.
6. While comparing, you may show multiple candidate markers. For the final
   recommendation, mark only the chosen site, fly there, and highlight that
   neighbourhood.

Use compose_map_actions to focus the map, highlight neighbourhoods, draw
points/lines/polygons, and annotate so the user can see your reasoning.
Drawing that collides with an existing overlay returns an error; move or
remove first.

Prefer run_python for quantitative screening and hypotheses (read-only Mongo
db, pandas/numpy/scipy/statsmodels/sklearn, DATA_DIR). Assign RESULT for a
dataframe preview. Toronto data only. Avoid query_city_layer when a python
filter would return a cleaner, smaller RESULT.

Efficiency budgets (token + latency):
- Pack screening into 1-2 run_python calls; do not micro-iterate five tiny scripts.
- score_population at most 2-3 shortlisted candidates per turn (pass
  neighbourhoodCodes); never spray five citywide scores.
- compose_map_actions: one compare batch and/or one final lock-in, not every
  intermediate thought.
- Factual lookups (highest density, population of X): one run_python, then
  answer immediately in prose. Always leave a short Markdown final answer.

Stay a competent chat colleague. Do not invent ScenarioPatches or rankings
when tools are not useful. When you do score acceptance, it is simulated
day-one feel, never ridership or real public opinion.

Final answer is Markdown to the user. Be concise: lead with the answer in
1-3 sentences, then at most a short bullet list for the few details that
actually change the decision (including acceptance if you scored). Skip
boilerplate section headers and repeated disclaimers -- only go into depth
(ROI breakdown, KPI list, etc.) if the user actually asks for that level of
detail.
`.trim(),
  }),

  "geospatial-twin": role({
    key: "geospatial-twin",
    name: "TechTO — Geospatial Twin",
    shortDescription: "Query/patch city geometry, land use, networks via twin verbs.",
    uiGroup: "Planning",
    memory: "Readonly",
    modelRequirement: MODEL_PROFILES.TOOL_ANALYSIS,
    toolNames: [
      TOOL_NAMES.GET_CURRENT_MAP_CONTEXT,
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
    name: "TechTO — Scenario Designer",
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
    name: "TechTO — Citizen Response",
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
    name: "TechTO — Equity Impact",
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
    name: "TechTO — Feasibility",
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
them; they are tools, not your identity. For ROI, separate measured inputs,
modeled monetized benefits, assumptions, and scenario ranges. Never claim an
ROI figure when lifecycle cost or benefit evidence is missing. Use run_python
for quantitative hypotheses (read-only Mongo + scientific Python stack).
`.trim(),
  }),

  "adversarial-reviewer": role({
    key: "adversarial-reviewer",
    name: "TechTO — Adversarial Reviewer",
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
    name: "TechTO — Evidence Auditor",
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
    name: "TechTO — Final Policy Judge",
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
    name: "TechTO — Explanation and Map",
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
export const PRINCIPLED_CITY_BUNDLE: readonly TechTOAssistantKey[] = [
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
} as const satisfies Record<string, readonly TechTOAssistantKey[]>;

export const INTENT_BUNDLES: Record<PlanningIntent, readonly TechTOAssistantKey[]> = {
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
): TechTOAssistantKey[] {
  return Array.from(new Set(INTENT_BUNDLES[intent]));
}

export function selectAssistantBundle(
  scenarioId: string,
  options?: { includeConcert?: boolean; includeWeather?: boolean },
): TechTOAssistantKey[] {
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
  return TECHTO_ASSISTANT_KEYS.map((key) => ASSISTANT_ROSTER[key]);
}

export function getAssistantRole(key: TechTOAssistantKey): AssistantRoleDefinition {
  return ASSISTANT_ROSTER[key];
}

export function isTechTOAssistantKey(value: string): value is TechTOAssistantKey {
  return (TECHTO_ASSISTANT_KEYS as readonly string[]).includes(value);
}
