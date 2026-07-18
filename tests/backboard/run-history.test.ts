import { beforeEach, describe, expect, it } from "vitest";

import {
  RUN_HISTORY_STORAGE_KEY,
  clearRunHistory,
  deleteRun,
  loadRunHistory,
  upsertRun,
  type StoredTwinTORun,
} from "@/lib/twinto/run-history";

function makeRun(overrides: Partial<StoredTwinTORun> = {}): StoredTwinTORun {
  return {
    runId: "run-1",
    scenarioId: "departure-406-412",
    recommendationHeadline: null,
    status: "running",
    startedAt: new Date().toISOString(),
    completedAt: null,
    events: [],
    result: null,
    error: null,
    ...overrides,
  };
}

describe("run-history (jsdom localStorage)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns an empty array when nothing is stored", () => {
    expect(loadRunHistory()).toEqual([]);
  });

  it("upsertRun persists a run and loadRunHistory reads it back", () => {
    const run = makeRun();
    upsertRun(run);
    const loaded = loadRunHistory();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].runId).toBe("run-1");
    expect(window.localStorage.getItem(RUN_HISTORY_STORAGE_KEY)).toBeTruthy();
  });

  it("upsertRun replaces an existing run with the same runId rather than duplicating it", () => {
    upsertRun(makeRun({ status: "running" }));
    upsertRun(makeRun({ status: "completed", recommendationHeadline: "Approve the retiming" }));
    const loaded = loadRunHistory();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].status).toBe("completed");
    expect(loaded[0].recommendationHeadline).toBe("Approve the retiming");
  });

  it("upsertRun puts the most recently touched run first", () => {
    upsertRun(makeRun({ runId: "run-a" }));
    upsertRun(makeRun({ runId: "run-b" }));
    const loaded = loadRunHistory();
    expect(loaded[0].runId).toBe("run-b");
    expect(loaded[1].runId).toBe("run-a");
  });

  it("caps stored history at 20 runs, dropping the oldest", () => {
    for (let i = 0; i < 25; i += 1) {
      upsertRun(makeRun({ runId: `run-${i}` }));
    }
    const loaded = loadRunHistory();
    expect(loaded).toHaveLength(20);
    expect(loaded[0].runId).toBe("run-24");
    expect(loaded.map((run) => run.runId)).not.toContain("run-0");
  });

  it("deleteRun removes only the targeted run", () => {
    upsertRun(makeRun({ runId: "run-a" }));
    upsertRun(makeRun({ runId: "run-b" }));
    deleteRun("run-a");
    const loaded = loadRunHistory();
    expect(loaded.map((run) => run.runId)).toEqual(["run-b"]);
  });

  it("clearRunHistory empties storage entirely", () => {
    upsertRun(makeRun());
    clearRunHistory();
    expect(loadRunHistory()).toEqual([]);
    expect(window.localStorage.getItem(RUN_HISTORY_STORAGE_KEY)).toBeNull();
  });

  it("ignores malformed JSON already sitting in storage rather than throwing", () => {
    window.localStorage.setItem(RUN_HISTORY_STORAGE_KEY, "{not valid json");
    expect(loadRunHistory()).toEqual([]);
  });

  it("filters out entries that do not look like a StoredTwinTORun", () => {
    window.localStorage.setItem(RUN_HISTORY_STORAGE_KEY, JSON.stringify([{ notARun: true }, makeRun({ runId: "run-good" })]));
    const loaded = loadRunHistory();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].runId).toBe("run-good");
  });
});
