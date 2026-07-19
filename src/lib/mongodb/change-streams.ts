import type { ChangeStreamDocument } from "mongodb";

import { getMongoDb } from "@/lib/mongodb/client";
import { COLLECTIONS } from "@/lib/mongodb/collections";
import { isMongoConfigured } from "@/lib/mongodb/env";

export type TechTOWatchCollection =
  | "backboard_events"
  | "simulation_runs"
  | "policy_iterations"
  | "latest_stop_state";

const WATCHABLE: Record<TechTOWatchCollection, string> = {
  backboard_events: COLLECTIONS.backboardEvents,
  simulation_runs: COLLECTIONS.simulationRuns,
  policy_iterations: COLLECTIONS.policyIterations,
  latest_stop_state: COLLECTIONS.latestStopState,
};

export interface ChangeStreamNotice {
  collection: TechTOWatchCollection;
  operationType: string;
  documentKey?: unknown;
  fullDocument?: unknown;
  clusterTime?: unknown;
}

/**
 * Opens a MongoDB change stream for one operational collection.
 * Caller must close the stream. Requires a replica set (Atlas qualifies).
 */
export async function openTechTOChangeStream(
  collection: TechTOWatchCollection,
  onChange: (notice: ChangeStreamNotice) => void,
  onError?: (error: Error) => void,
): Promise<{ close: () => Promise<void> }> {
  if (!isMongoConfigured()) {
    throw new Error("MongoDB is not configured.");
  }

  const db = await getMongoDb();
  const name = WATCHABLE[collection];
  const stream = db.collection(name).watch([], { fullDocument: "updateLookup" });

  stream.on("change", (change: ChangeStreamDocument) => {
    onChange({
      collection,
      operationType: change.operationType,
      documentKey: "documentKey" in change ? change.documentKey : undefined,
      fullDocument: "fullDocument" in change ? change.fullDocument : undefined,
      clusterTime: "clusterTime" in change ? change.clusterTime : undefined,
    });
  });

  stream.on("error", (error: Error) => {
    onError?.(error);
  });

  return {
    close: async () => {
      await stream.close();
    },
  };
}
