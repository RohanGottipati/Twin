import { z } from "zod";

export const DEFAULT_HORIZON_INTERVALS = 24;
export const DEFAULT_INTERVAL_MINUTES = 60;

/**
 * Mirrors DispatchInterval/DispatchPlan from ./types.ts. This is the contract
 * every Backboard-generated dispatch candidate must satisfy before the
 * deterministic validator or simulator ever sees it. Unknown fields are
 * rejected so a model cannot smuggle extra, unvalidated instructions through.
 */
export const dispatchIntervalSchema = z
  .object({
    timestamp: z.string().min(1),
    chargeMw: z.number().finite().min(0),
    dischargeMw: z.number().finite().min(0),
    reserveMw: z.number().finite().min(0),
    rationale: z.string().min(1).max(500),
    confidence: z.number().finite().min(0).max(1),
  })
  .strict()
  .refine((interval) => !(interval.chargeMw > 0 && interval.dischargeMw > 0), {
    message: "An interval cannot charge and discharge at the same time.",
    path: ["dischargeMw"],
  });

export const dispatchPlanSchema = z
  .object({
    schemaVersion: z.literal(1),
    assetId: z.string().min(1),
    scenarioId: z.string().min(1),
    horizonStart: z.string().min(1),
    intervalMinutes: z.number().int().positive(),
    strategy: z.string().min(1).max(120),
    modelId: z.string().optional(),
    assumptions: z.array(z.string().max(300)).max(20).default([]),
    warnings: z.array(z.string().max(300)).max(20).default([]),
    intervals: z.array(dispatchIntervalSchema).min(1).max(96),
  })
  .strict();

export type DispatchPlanInput = z.input<typeof dispatchPlanSchema>;
export type DispatchPlanParsed = z.output<typeof dispatchPlanSchema>;

export const analystFindingSchema = z
  .object({
    role: z.string().min(1),
    headline: z.string().min(1).max(200),
    summary: z.string().min(1).max(1500),
    keySignals: z.array(z.string().max(200)).max(10).default([]),
    confidence: z.number().finite().min(0).max(1),
  })
  .strict();

export type AnalystFinding = z.output<typeof analystFindingSchema>;

export const riskReviewSchema = z
  .object({
    candidateId: z.string().min(1),
    riskLevel: z.enum(["low", "medium", "high"]),
    summary: z.string().min(1).max(1500),
    concerns: z.array(z.string().max(300)).max(20).default([]),
    recommendation: z.enum(["approve", "approve_with_caution", "reject"]),
  })
  .strict();

export type RiskReview = z.output<typeof riskReviewSchema>;

export const finalRecommendationSchema = z
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
    ]),
  })
  .strict();

export type FinalRecommendation = z.output<typeof finalRecommendationSchema>;

export const executiveSummarySchema = z
  .object({
    headline: z.string().min(1).max(200),
    narrative: z.string().min(1).max(2000),
    highlights: z.array(z.string().max(300)).max(8).default([]),
    watchItems: z.array(z.string().max(300)).max(8).default([]),
  })
  .strict();

export type ExecutiveSummary = z.output<typeof executiveSummarySchema>;

export const operatorExplanationSchema = z
  .object({
    answer: z.string().min(1).max(2000),
    citedEvidence: z.array(z.string().max(300)).max(10).default([]),
  })
  .strict();

export type OperatorExplanation = z.output<typeof operatorExplanationSchema>;
