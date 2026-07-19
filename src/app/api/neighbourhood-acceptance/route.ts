import { getMongoDb } from "@/lib/mongodb/client";
import { COLLECTIONS } from "@/lib/mongodb/collections";
import { computeRealNeighbourhoodAcceptance } from "@/lib/citizen-reaction/neighbourhood-acceptance";
import { getScenario } from "@/lib/sim/scenarios";
import { createSseResponse, createSseStream } from "@/lib/backboard/sse";
import { errorMessage, jsonError } from "@/lib/backboard/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Streams real, Monte-Carlo-sampled per-neighbourhood acceptance for the
 * homepage map: for a given scenario, samples real resident_personas per
 * neighbourhood, calls the real trained opinion model (cached), and scores
 * with the real-vote-trained embedding probe. One SSE event per
 * neighbourhood as it completes, so the map updates incrementally instead
 * of waiting for all ~158 neighbourhoods (each event is `{code, acceptance}`;
 * a final `{done: true}` event closes the stream). Replaces the
 * deterministic `src/lib/sim/engine.ts` proximity formula, which predicts
 * nothing.
 */
export async function GET(request: Request) {
  const scenarioId = new URL(request.url).searchParams.get("scenarioId") ?? "baseline";
  let scenario;
  try {
    scenario = getScenario(scenarioId);
  } catch (error) {
    return jsonError(errorMessage(error), 400);
  }

  const stream = createSseStream(async (writer) => {
    const db = await getMongoDb();
    const codes = (await db.collection(COLLECTIONS.residentPersonas).distinct("neighbourhood_code")) as string[];

    await computeRealNeighbourhoodAcceptance(scenario, codes, (code, acceptance) => {
      writer.send({ code, acceptance });
    });

    writer.send({ done: true });
    writer.close();
  });

  return createSseResponse(stream);
}
