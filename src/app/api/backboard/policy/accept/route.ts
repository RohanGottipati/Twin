import { z } from "zod";

import { acceptPolicyIteration } from "@/lib/mongodb/accept-policy";
import { errorMessage, jsonError } from "@/lib/backboard/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const acceptSchema = z
  .object({
    runId: z.string().min(1).max(120),
    scenarioId: z.string().min(1).max(80),
    interventionId: z.string().min(1).max(80),
    recommendedAction: z.enum([
      "approve",
      "approve_with_monitoring",
      "hold_for_operator",
      "reject_unsafe",
    ]),
    metrics: z.record(z.string(), z.unknown()).optional(),
    recommendation: z.record(z.string(), z.unknown()).optional(),
    modelVersion: z.string().min(1).max(80).optional(),
    notes: z.string().max(2000).optional(),
    createTrainingExample: z.boolean().optional(),
  })
  .strict();

/**
 * Accepts a recommended policy iteration and writes the §14.9 transaction
 * bundle (status, metrics, model version, audit, training candidate).
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = acceptSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("Invalid request body.", 400, { issues: parsed.error.issues });
  }

  try {
    const result = await acceptPolicyIteration(parsed.data);
    if (!result.accepted) {
      return jsonError(result.error ?? "Failed to accept policy.", 503, {
        acceptanceId: result.acceptanceId,
        usedTransaction: result.usedTransaction,
      });
    }
    return Response.json(result);
  } catch (error) {
    return jsonError("Failed to accept policy.", 500, { detail: errorMessage(error) });
  }
}
