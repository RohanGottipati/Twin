/**
 * TechTO MongoDB Atlas collection names (docs/techto-implementation.md §14).
 * `transit_scenarios` and `stress_overlays` are demo operational collections
 * required for the flagship schedule scenario; they are not live TTC feeds.
 */

export const COLLECTIONS = {
  cities: "cities",
  neighbourhoods: "neighbourhoods",
  transitRoutes: "transit_routes",
  transitStops: "transit_stops",
  transitTrips: "transit_trips",
  transitShapes: "transit_shapes",
  transitScenarios: "transit_scenarios",
  stressOverlays: "stress_overlays",
  roadSegments: "road_segments",
  places: "places",
  citizenCohorts: "citizen_cohorts",
  socialContexts: "social_contexts",
  /** Real StatCan-census-grounded individual resident records (population/generate_and_store_personas.py). */
  residentPersonas: "resident_personas",
  activityPlans: "activity_plans",
  journeyTemplates: "journey_templates",
  interventions: "interventions",
  policyIterations: "policy_iterations",
  simulationRuns: "simulation_runs",
  simulationBranches: "simulation_branches",
  citizenReactions: "citizen_reactions",
  policyEvaluations: "policy_evaluations",
  events: "events",
  incidents: "incidents",
  backboardAssistants: "backboard_assistants",
  backboardThreads: "backboard_threads",
  backboardEvents: "backboard_events",
  backboardToolCalls: "backboard_tool_calls",
  trainingExamples: "training_examples",
  modelVersions: "model_versions",
  evaluationRuns: "evaluation_runs",
  documents: "documents",
  documentChunks: "document_chunks",
  auditEvents: "audit_events",
  latestCityState: "latest_city_state",
  latestRouteState: "latest_route_state",
  latestStopState: "latest_stop_state",
  rawIngestEvents: "raw_ingest_events",
  streamDeadLetters: "stream_dead_letters",
  similarInterventions: "similar_interventions",
  /** Cache of real per-persona opinion generations, keyed by (personaId, policyHash). */
  opinionReactionsCache: "opinion_reactions_cache",
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];

/** Time-series collections (§14.2). Created with timeField/metaField. */
export const TIME_SERIES_COLLECTIONS = {
  agentPositions: "agent_positions_ts",
  vehiclePositions: "vehicle_positions_ts",
  stopLoad: "stop_load_ts",
  routePerformance: "route_performance_ts",
  trafficSpeed: "traffic_speed_ts",
  density: "density_ts",
  emissions: "emissions_ts",
  simulationMetrics: "simulation_metrics_ts",
} as const;

export const DEMO_PROVENANCE = {
  sourceType: "synthetic" as const,
  sourceName: "TechTO demo fixtures (src/data/transit)",
  sourceUrl: null as string | null,
  retrievedAt: null as string | null,
  transformationVersion: "techto-demo-1",
  syntheticFields: ["*"],
};
