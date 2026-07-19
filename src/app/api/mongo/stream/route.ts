import { errorMessage, jsonError } from "@/lib/backboard/route-helpers";
import { createSseResponse, createSseStream } from "@/lib/backboard/sse";
import {
  openTechTOChangeStream,
  type TechTOWatchCollection,
} from "@/lib/mongodb/change-streams";
import { isMongoConfigured } from "@/lib/mongodb/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED: TechTOWatchCollection[] = [
  "backboard_events",
  "simulation_runs",
  "policy_iterations",
  "latest_stop_state",
];

/**
 * SSE change-stream proxy for one TechTO operational collection.
 * Query: ?collection=backboard_events
 */
export async function GET(request: Request) {
  if (!isMongoConfigured()) {
    return jsonError("MongoDB is not configured.", 503);
  }

  const url = new URL(request.url);
  const collection = (url.searchParams.get("collection") ?? "backboard_events") as TechTOWatchCollection;
  if (!ALLOWED.includes(collection)) {
    return jsonError(`Unsupported collection. Allowed: ${ALLOWED.join(", ")}`, 400);
  }

  let closed = false;
  request.signal.addEventListener("abort", () => {
    closed = true;
  });

  const stream = createSseStream(async (writer) => {
    let closer: (() => Promise<void>) | null = null;
    try {
      const handle = await openTechTOChangeStream(
        collection,
        (notice) => {
          if (closed || writer.closed) return;
          writer.send({
            eventId: `${collection}:${Date.now()}`,
            runId: "change-stream",
            sequence: Date.now(),
            type: "mongo.change",
            timestamp: new Date().toISOString(),
            payload: notice as unknown as Record<string, unknown>,
          });
        },
        (error) => {
          if (closed || writer.closed) return;
          writer.send({
            eventId: `${collection}:error`,
            runId: "change-stream",
            sequence: Date.now(),
            type: "mongo.change.failed",
            timestamp: new Date().toISOString(),
            payload: { message: error.message },
          });
        },
      );
      closer = handle.close;

      writer.send({
        eventId: `${collection}:open`,
        runId: "change-stream",
        sequence: 0,
        type: "mongo.change.opened",
        timestamp: new Date().toISOString(),
        payload: { collection },
      });

      // Keep the SSE connection open until the client disconnects.
      await new Promise<void>((resolve) => {
        const check = () => {
          if (closed || writer.closed) resolve();
          else setTimeout(check, 1000);
        };
        check();
      });
    } catch (error) {
      writer.send({
        eventId: `${collection}:error`,
        runId: "change-stream",
        sequence: Date.now(),
        type: "mongo.change.failed",
        timestamp: new Date().toISOString(),
        payload: { message: errorMessage(error) },
      });
    } finally {
      if (closer) await closer().catch(() => undefined);
    }
  });

  return createSseResponse(stream);
}
