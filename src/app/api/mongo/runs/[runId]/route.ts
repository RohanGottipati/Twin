import { getPlanningRun, listPlanningRunEvents } from "@/lib/mongodb/planning-store";
import { errorMessage, jsonError } from "@/lib/backboard/route-helpers";
import { isMongoConfigured } from "@/lib/mongodb/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Returns a persisted planning-run document and its event timeline from Atlas.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ runId: string }> | { runId: string } },
) {
  if (!isMongoConfigured()) {
    return jsonError("MongoDB is not configured.", 503);
  }

  try {
    const params = await Promise.resolve(context.params);
    const runId = params.runId?.trim();
    if (!runId) return jsonError("runId is required.", 400);

    const run = await getPlanningRun(runId);
    if (!run) return jsonError("Planning run not found.", 404);

    const events = await listPlanningRunEvents(runId);
    return Response.json({ run, events });
  } catch (error) {
    return jsonError("Failed to load planning run.", 500, { detail: errorMessage(error) });
  }
}
