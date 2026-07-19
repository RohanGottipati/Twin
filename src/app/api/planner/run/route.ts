import { NextResponse } from "next/server";

import { PRINCIPLED_CITY_BUNDLE } from "@/lib/backboard/assistants";
import { runCityOrchestration } from "@/lib/planner/orchestrator";
import { plannerRunBodySchema } from "@/lib/planner/request";
import { getCitizenReactionProviderMode } from "@/lib/citizen-reaction/provider";

export const runtime = "nodejs";

/**
 * Headless / UI city planning run: live Backboard Planning Orchestrator +
 * local twin/population score. May return mapActions for the MapLibre UI.
 * Prefer /api/planner/stream when the chat UI wants token deltas.
 */
export async function POST(request: Request) {
  const json = await request.json();
  const body = plannerRunBodySchema.parse(json);
  const result = await runCityOrchestration({
    question: body.question,
    patches: body.patches,
    seed: body.seed ?? 2262,
    agentOverlays: body.agentOverlays,
    threadId: body.threadId,
    history: body.history,
  });

  return NextResponse.json({
    schemaVersion: 1,
    backboardMode: result.adapterMode,
    populationMode: getCitizenReactionProviderMode(),
    availableRoster: PRINCIPLED_CITY_BUNDLE,
    participatingAgents: result.participatingAgents,
    runId: result.runId,
    threadId: result.threadId,
    question: result.question,
    ranking: result.ranking,
    chosenId: result.chosenId,
    summary: result.summary,
    mapActions: result.mapActions,
    events: result.events,
    candidates: result.candidates.map((c) => ({
      patch: c.patch,
      score: {
        scenarioId: c.score.scenarioId,
        provider: c.score.provider,
        citywide: c.score.citywide,
        byNeighbourhood: c.score.byNeighbourhood,
      },
    })),
  });
}
