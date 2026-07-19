import { z } from "zod";

import type { TransitCohortFixture } from "@/data/transit/cohorts";

/**
 * Zod contracts for the TechTO deterministic transit domain layer (see
 * docs/techto-implementation.md sections 2 and 11). These schemas are the
 * boundary every Backboard-facing tool, simulator input, and simulator
 * result must satisfy: unknown fields are rejected with .strict() so a
 * model or caller cannot smuggle unvalidated fields through. Everything
 * here describes a synthetic fixture demo, never live TTC data or real
 * public consultation; see the "dataMode" literal used throughout.
 */

export const SYNTHETIC_FIXTURE_DATA_MODE = "synthetic-fixture" as const;
export const dataModeSchema = z.literal(SYNTHETIC_FIXTURE_DATA_MODE);
export type DataMode = z.output<typeof dataModeSchema>;

// ---------------------------------------------------------------------------
// Scenario and stress overlay
// ---------------------------------------------------------------------------

export const transitWindowSchema = z
  .object({
    start: z.string().min(1),
    end: z.string().min(1),
  })
  .strict();

export type TransitWindow = z.output<typeof transitWindowSchema>;

export const arrivalPointSchema = z
  .object({
    /** Clock time in the scenario's local timezone, formatted "HH:MM". */
    minute: z.string().min(1),
    arrivals: z.number().int().nonnegative(),
  })
  .strict();

export type ArrivalPoint = z.output<typeof arrivalPointSchema>;

export const transitScenarioSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1).max(200),
    description: z.string().min(1).max(2000).optional(),
    dataMode: dataModeSchema,
    window: transitWindowSchema,
    baselineDepartures: z.array(z.string().min(1)).min(1).max(20),
    stationId: z.string().min(1),
    routeId: z.string().min(1),
    arrivalsByMinute: z.array(arrivalPointSchema).min(1),
    vehicleCapacity: z.number().int().positive(),
    /** Connecting route IDs a meaningful number of riders transfer to or from at stationId. */
    transferRouteIds: z.array(z.string().min(1)).default([]),
    tags: z.array(z.string().min(1)).default([]),
  })
  .strict();

export type TransitScenario = z.output<typeof transitScenarioSchema>;

export const entranceClosureOverlaySchema = z
  .object({
    stationId: z.string().min(1),
    entranceId: z.string().min(1),
    capacityReductionFraction: z.number().min(0).max(1),
  })
  .strict();

export const departureDelayOverlaySchema = z
  .object({
    departureId: z.string().min(1),
    delayMinutes: z.number().finite().min(0).max(30),
  })
  .strict();

export const connectingDelayOverlaySchema = z
  .object({
    routeId: z.string().min(1),
    delayMinutes: z.number().finite().min(0).max(30),
  })
  .strict();

export const transitStressOverlaySchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1).max(200),
    description: z.string().min(1).max(1000).optional(),
    dataMode: dataModeSchema,
    /** Multiplier applied to arrival counts, for example 1.25 for a 25% event surge. */
    arrivalSurgeMultiplier: z.number().finite().positive().default(1),
    surgeFromMinute: z.number().int().nonnegative().optional(),
    surgeToMinute: z.number().int().nonnegative().optional(),
    entranceClosures: z.array(entranceClosureOverlaySchema).default([]),
    departureDelays: z.array(departureDelayOverlaySchema).default([]),
    connectingDelays: z.array(connectingDelayOverlaySchema).default([]),
  })
  .strict();

export type TransitStressOverlay = z.output<typeof transitStressOverlaySchema>;

// ---------------------------------------------------------------------------
// Interventions
// ---------------------------------------------------------------------------

export const shiftDepartureActionSchema = z
  .object({
    type: z.literal("shift_departure_minutes"),
    departureId: z.string().min(1),
    deltaMinutes: z.number().finite().min(-30).max(30),
  })
  .strict();

export const addTripActionSchema = z
  .object({
    type: z.literal("add_trip"),
    afterDepartureId: z.string().min(1),
    offsetMinutes: z.number().finite().min(1).max(30),
    vehicleCapacity: z.number().int().positive(),
  })
  .strict();

export const capacityBoostActionSchema = z
  .object({
    type: z.literal("capacity_boost"),
    departureId: z.string().min(1),
    extraCapacity: z.number().int().nonnegative(),
  })
  .strict();

export const entranceClosureActionSchema = z
  .object({
    type: z.literal("entrance_closure"),
    stationId: z.string().min(1),
    entranceId: z.string().min(1),
    capacityReductionFraction: z.number().min(0).max(1),
  })
  .strict();

export const holdDepartureActionSchema = z
  .object({
    type: z.literal("hold_departure"),
    departureId: z.string().min(1),
    holdMinutes: z.number().finite().min(0).max(10),
  })
  .strict();

export const retimeFeederActionSchema = z
  .object({
    type: z.literal("retime_feeder"),
    routeId: z.string().min(1),
    deltaMinutes: z.number().finite().min(-15).max(15),
  })
  .strict();

export const transitInterventionActionSchema = z.discriminatedUnion("type", [
  shiftDepartureActionSchema,
  addTripActionSchema,
  capacityBoostActionSchema,
  entranceClosureActionSchema,
  holdDepartureActionSchema,
  retimeFeederActionSchema,
]);

export type TransitInterventionAction = z.output<typeof transitInterventionActionSchema>;

export const transitInterventionSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1).max(200),
    description: z.string().min(1).max(1000).optional(),
    actions: z.array(transitInterventionActionSchema).min(1).max(10),
  })
  .strict();

export type TransitIntervention = z.output<typeof transitInterventionSchema>;

// ---------------------------------------------------------------------------
// Simulation primitives: departure loads, queue trace, violations
// ---------------------------------------------------------------------------

export const violationSeveritySchema = z.enum(["error", "warning"]);
export type ViolationSeverity = z.output<typeof violationSeveritySchema>;

export const violationSchema = z
  .object({
    code: z.string().min(1),
    severity: violationSeveritySchema,
    /** Minute offset from the simulation window start; -1 means "not tied to a single minute". */
    minute: z.number().int(),
    message: z.string().min(1),
  })
  .strict();

export type Violation = z.output<typeof violationSchema>;

export const departureLoadSchema = z
  .object({
    departureId: z.string().min(1),
    scheduledTime: z.string().min(1),
    actualTime: z.string().min(1),
    capacity: z.number().int().nonnegative(),
    boarded: z.number().int().nonnegative(),
    denied: z.number().int().nonnegative(),
    loadFactor: z.number().finite().nonnegative(),
  })
  .strict();

export type DepartureLoad = z.output<typeof departureLoadSchema>;

export const queuePointSchema = z
  .object({
    minute: z.number().int(),
    clockTime: z.string().min(1),
    stationId: z.string().min(1),
    queueLength: z.number().int().nonnegative(),
  })
  .strict();

export type QueuePoint = z.output<typeof queuePointSchema>;

// ---------------------------------------------------------------------------
// Simulation input, metrics, and result
// ---------------------------------------------------------------------------

export const transitMetricsSchema = z
  .object({
    meanWaitMinutes: z.number().finite().nonnegative(),
    p90WaitMinutes: z.number().finite().nonnegative(),
    deniedBoardings: z.number().int().nonnegative(),
    loadImbalance: z.number().finite().nonnegative(),
    missedTransfers: z.number().int().nonnegative(),
    estimatedCarTrips: z.number().finite().nonnegative(),
    estimatedCarbonKg: z.number().finite(),
    accessibilityFailures: z.number().int().nonnegative(),
    equityGap: z.number().finite().nonnegative(),
    operatingCostScore: z.number().finite(),
  })
  .strict();

export type TransitMetrics = z.output<typeof transitMetricsSchema>;

export const transitSimulationInputSchema = z
  .object({
    schemaVersion: z.literal(1),
    scenario: transitScenarioSchema,
    intervention: transitInterventionSchema.nullable(),
    stressOverlay: transitStressOverlaySchema.nullable(),
    seed: z.number().int(),
    /**
     * Cohorts to use for this simulation's equity-gap and car-switch-probability
     * math. Optional and never itself validated (this schema is a TS-type
     * source, not a runtime parse boundary) — omitted, `simulateTransit`
     * falls back to the static synthetic fixture. Passed explicitly by every
     * server-side caller that has a resolved TransitRepository, so real
     * resident-persona-aggregate cohorts (once seeded) drive the simulation
     * instead of the 11 synthetic-fixture cohorts.
     */
    cohorts: z.custom<TransitCohortFixture[]>().optional(),
  })
  .strict();

export type TransitSimulationInput = z.output<typeof transitSimulationInputSchema>;

export const transitSimulationResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    scenarioId: z.string().min(1),
    interventionId: z.string().min(1).nullable(),
    stressOverlayId: z.string().min(1).nullable(),
    seed: z.number().int(),
    dataMode: dataModeSchema,
    valid: z.boolean(),
    violations: z.array(violationSchema).default([]),
    departureLoads: z.array(departureLoadSchema).default([]),
    queueTrace: z.array(queuePointSchema).default([]),
    metrics: transitMetricsSchema,
  })
  .strict();

export type TransitSimulationResult = z.output<typeof transitSimulationResultSchema>;

// ---------------------------------------------------------------------------
// Policy candidates and final recommendation
// ---------------------------------------------------------------------------

export const policyCandidateBreakdownSchema = z
  .object({
    wait: z.number().finite(),
    crowding: z.number().finite(),
    reliability: z.number().finite(),
    equity: z.number().finite(),
    carbon: z.number().finite(),
    operatingCost: z.number().finite(),
  })
  .strict();

export type PolicyCandidateBreakdown = z.output<typeof policyCandidateBreakdownSchema>;

export const policyCandidateSchema = z
  .object({
    candidateId: z.string().min(1),
    interventionId: z.string().min(1),
    label: z.string().min(1).max(200),
    rank: z.number().int().positive(),
    score: z.number().finite(),
    disqualified: z.boolean(),
    disqualifyReason: z.string().max(300).optional(),
    violationCount: z.number().int().nonnegative(),
    breakdown: policyCandidateBreakdownSchema,
    metrics: transitMetricsSchema,
    dataMode: dataModeSchema,
  })
  .strict();

export type PolicyCandidate = z.output<typeof policyCandidateSchema>;

export const finalPolicyRecommendationSchema = z
  .object({
    chosenCandidateId: z.string().min(1),
    headline: z.string().min(1).max(200),
    reasoning: z.string().min(1).max(2000),
    tradeoffs: z.array(z.string().max(300)).max(10).default([]),
    confidence: z.number().finite().min(0).max(1),
    recommendedAction: z.enum([
      "approve",
      "approve_with_monitoring",
      "hold_for_operator",
      "reject_unsafe",
    ]),
    dataMode: dataModeSchema,
  })
  .strict();

export type FinalPolicyRecommendation = z.output<typeof finalPolicyRecommendationSchema>;

// ---------------------------------------------------------------------------
// Run event envelope (mirrors BackboardRunEventEnvelope in ./backboard/wire-types)
// ---------------------------------------------------------------------------

/**
 * Frontend-safe envelope every TechTO transit run stream wraps its events
 * in. payload is deliberately a plain record: the concrete shape varies per
 * event `type` and is validated further upstream (see src/lib/techto/types.ts
 * TechTORunEvent), but the envelope itself only needs to guarantee it never
 * carries a raw reasoning/thinking field across the wire.
 */
export const techTORunEventEnvelopeSchema = z
  .object({
    eventId: z.string().min(1),
    runId: z.string().min(1),
    sequence: z.number().int().nonnegative(),
    type: z.string().min(1),
    timestamp: z.string().min(1),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict()
  .refine(
    (envelope) => !("reasoning" in envelope.payload) && !("thinking" in envelope.payload),
    {
      message: "Event envelopes must never carry raw reasoning or thinking content.",
      path: ["payload"],
    },
  );

export type TechTORunEventEnvelope = z.output<typeof techTORunEventEnvelopeSchema>;

// ---------------------------------------------------------------------------
// Analyst findings (Backboard council evidence, transit-flavored)
// ---------------------------------------------------------------------------

export const transitAnalystFindingSchema = z
  .object({
    role: z.string().min(1),
    department: z.string().min(1).optional(),
    headline: z.string().min(1).max(200),
    summary: z.string().min(1).max(1500),
    keySignals: z.array(z.string().max(200)).max(10).default([]),
    confidence: z.number().finite().min(0).max(1),
  })
  .strict();

export type TransitAnalystFinding = z.output<typeof transitAnalystFindingSchema>;

// ---------------------------------------------------------------------------
// Cohort reaction summary (CitizenReactionLM output contract, see
// docs/techto-implementation.md section 10.3, and its population-level
// aggregate for the Backboard council)
// ---------------------------------------------------------------------------

export const cohortModeSchema = z.enum(["transit", "car", "walk", "cycle"]);
export type CohortMode = z.output<typeof cohortModeSchema>;

export const cohortReasonCodeSchema = z.enum([
  "better_schedule_alignment",
  "lower_expected_wait",
  "reduced_crowding",
  "increased_crowding",
  "missed_transfer_risk",
  "accessibility_barrier",
  "improved_accessibility",
  "cost_increase",
  "improved_reliability",
  "event_disruption",
  "no_material_change",
]);

export type CohortReasonCode = z.output<typeof cohortReasonCodeSchema>;

export const cohortReactionSchema = z
  .object({
    schemaVersion: z.literal(1),
    cohortId: z.string().min(1),
    previousMode: cohortModeSchema,
    newMode: cohortModeSchema,
    departureShiftMinutes: z.number().finite(),
    waitToleranceMinutes: z.number().finite().nonnegative(),
    boardsTargetDeparture: z.boolean(),
    tripCancelled: z.boolean(),
    adoptionProbability: z.number().min(0).max(1),
    policySupport: z.number().min(0).max(1),
    reasonCodes: z.array(cohortReasonCodeSchema).max(6).default([]),
    confidence: z.number().min(0).max(1),
    warnings: z.array(z.string().max(300)).max(10).default([]),
  })
  .strict();

export type CohortReaction = z.output<typeof cohortReactionSchema>;

export const cohortReasonCodeTallySchema = z
  .object({
    code: cohortReasonCodeSchema,
    count: z.number().int().nonnegative(),
  })
  .strict();

export const cohortReactionSummarySchema = z
  .object({
    scenarioId: z.string().min(1),
    interventionId: z.string().min(1).nullable(),
    dataMode: dataModeSchema,
    cohortCount: z.number().int().nonnegative(),
    weightedSupport: z.number().min(0).max(1),
    weightedAdoption: z.number().min(0).max(1),
    modeShiftSummary: z.record(z.string(), z.number()).default({}),
    topReasonCodes: z.array(cohortReasonCodeTallySchema).default([]),
    reactions: z.array(cohortReactionSchema).default([]),
  })
  .strict();

export type CohortReactionSummary = z.output<typeof cohortReactionSummarySchema>;

// ---------------------------------------------------------------------------
// Operator explanation and executive summary (Backboard council prose output)
// ---------------------------------------------------------------------------

/**
 * The TTC Operator Explanation Agent's structured answer to a free-text
 * operator question (see src/lib/backboard/operator.ts). `answer` is the
 * only prose field a model authors; `citedEvidence` points back to concrete
 * run evidence (candidateIds, tool names, fixture ids) rather than general
 * knowledge, per AGENTS.md 3.3 (the audit trail is the product).
 */
export const operatorExplanationSchema = z
  .object({
    answer: z.string().min(1).max(2000),
    citedEvidence: z.array(z.string().max(300)).max(10).default([]),
  })
  .strict();

export type OperatorExplanation = z.output<typeof operatorExplanationSchema>;

/**
 * The city-planner-facing brief for one completed TechTO run. The metric
 * fields and safetyResult are always populated server-side straight from
 * TechTORunResult / TransitMetrics, never from a model's own arithmetic;
 * only mainRisk, majorAssumption, limitations, and summary are ever
 * generated text (see src/lib/backboard/executive.ts).
 */
export const transitExecutiveSummarySchema = z
  .object({
    meanWaitMinutes: z.number().finite(),
    deniedBoardings: z.number().finite(),
    loadImbalance: z.number().finite(),
    equityGap: z.number().finite(),
    estimatedCarbonKg: z.number().finite(),
    operatingCostScore: z.number().finite(),
    safetyResult: z.enum(["clear", "overridden_for_safety", "hold_for_operator"]),
    mainRisk: z.string().min(1).max(500),
    majorAssumption: z.string().min(1).max(500),
    limitations: z.string().min(1).max(500),
    summary: z.string().min(1).max(800),
  })
  .strict();

export type TransitExecutiveSummary = z.output<typeof transitExecutiveSummarySchema>;
