import { z } from "zod";

import { requireScenario } from "@/data/transit/scenarios";
import { errorMessage, jsonError } from "@/lib/backboard/route-helpers";
import { boundedDepartureSearch } from "@/lib/optimization/bounded-search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    scenarioId: z.string().min(1),
    shiftARange: z.tuple([z.number().int(), z.number().int()]).optional(),
    shiftBRange: z.tuple([z.number().int(), z.number().int()]).optional(),
    limit: z.number().int().positive().max(50).optional(),
  })
  .strict();

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("Invalid request body.", 400, { issues: parsed.error.issues });
  }

  try {
    const scenario = requireScenario(parsed.data.scenarioId);
    const ranked = boundedDepartureSearch({
      scenario,
      shiftARange: parsed.data.shiftARange,
      shiftBRange: parsed.data.shiftBRange,
    });
    const limit = parsed.data.limit ?? 8;
    return Response.json({
      scenarioId: scenario.id,
      candidateCount: ranked.length,
      top: ranked.slice(0, limit).map((candidate) => ({
        id: candidate.id,
        label: candidate.label,
        shiftAMinutes: candidate.shiftAMinutes,
        shiftBMinutes: candidate.shiftBMinutes,
        objective: candidate.objective,
        valid: candidate.result.valid,
        metrics: candidate.result.metrics,
        intervention: candidate.intervention,
      })),
    });
  } catch (error) {
    return jsonError(errorMessage(error), 404);
  }
}
