import { beforeEach, describe, expect, it } from "vitest";

import { assertServerOnly, getBackboardApiKey, isBackboardMockMode } from "@/lib/backboard/env";
import { assertSafeKnowledgeRepoPath, KnowledgeUploadPathError } from "@/lib/backboard/knowledge-upload";
import { createRunContext, dispatchToolCall } from "@/lib/backboard/tool-dispatcher";
import { getBackboardAdapter, resetBackboardAdapterForTests } from "@/lib/backboard/adapter";
import { FLAGSHIP_SCENARIO_ID } from "@/data/transit/scenarios";

describe("assertServerOnly", () => {
  // vitest.config.ts runs every test under the jsdom environment, so
  // `window` is always defined here: this is exactly the "browser" case
  // Backboard modules must refuse to run in, making it a direct exercise of
  // the guard rather than a simulation.
  it("throws when called in a window-having (browser-like) environment", () => {
    expect(typeof window).not.toBe("undefined");
    expect(() => assertServerOnly("someBackboardModule")).toThrow(/must never run in the browser/);
  });

  it("includes the caller-supplied context in the error message", () => {
    expect(() => assertServerOnly("uploadKnowledgeDocuments")).toThrow(/uploadKnowledgeDocuments/);
  });
});

describe("BACKBOARD_API_KEY exposure", () => {
  it("env.ts never exports the raw key as a module-level constant, only accessor functions", async () => {
    const mod = await import("@/lib/backboard/env");
    expect(Object.keys(mod).sort()).toEqual(
      ["BackboardConfigError", "assertServerOnly", "getBackboardApiKey", "getBackboardBaseUrl", "isBackboardMockMode", "requireBackboardApiKey"].sort(),
    );
  });

  it("getBackboardApiKey reads only from BACKBOARD_API_KEY, never a NEXT_PUBLIC_-prefixed variable", () => {
    const previous = process.env.BACKBOARD_API_KEY;
    const previousPublic = process.env.NEXT_PUBLIC_BACKBOARD_API_KEY;
    try {
      delete process.env.BACKBOARD_API_KEY;
      process.env.NEXT_PUBLIC_BACKBOARD_API_KEY = "leaked-if-this-were-read";
      expect(getBackboardApiKey()).toBe("");
    } finally {
      if (previous === undefined) delete process.env.BACKBOARD_API_KEY;
      else process.env.BACKBOARD_API_KEY = previous;
      if (previousPublic === undefined) delete process.env.NEXT_PUBLIC_BACKBOARD_API_KEY;
      else process.env.NEXT_PUBLIC_BACKBOARD_API_KEY = previousPublic;
    }
  });

  it("defaults to mock mode whenever no API key is configured", () => {
    const previousKey = process.env.BACKBOARD_API_KEY;
    const previousMock = process.env.BACKBOARD_MOCK_MODE;
    try {
      delete process.env.BACKBOARD_API_KEY;
      delete process.env.BACKBOARD_MOCK_MODE;
      expect(isBackboardMockMode()).toBe(true);
    } finally {
      if (previousKey === undefined) delete process.env.BACKBOARD_API_KEY;
      else process.env.BACKBOARD_API_KEY = previousKey;
      if (previousMock === undefined) delete process.env.BACKBOARD_MOCK_MODE;
      else process.env.BACKBOARD_MOCK_MODE = previousMock;
    }
  });
});

describe("knowledge document path allowlist", () => {
  it("accepts a well-formed path under docs/backboard/knowledge/", () => {
    expect(() => assertSafeKnowledgeRepoPath("docs/backboard/knowledge/platform-safety-rules.md")).not.toThrow();
  });

  it("rejects a path that escapes the knowledge directory via traversal", () => {
    expect(() => assertSafeKnowledgeRepoPath("docs/backboard/knowledge/../../../etc/passwd")).toThrow(KnowledgeUploadPathError);
  });

  it("rejects an absolute path", () => {
    expect(() => assertSafeKnowledgeRepoPath("/etc/passwd")).toThrow(KnowledgeUploadPathError);
  });

  it("rejects a path outside the knowledge root entirely", () => {
    expect(() => assertSafeKnowledgeRepoPath("docs/backboard/architecture.md")).toThrow(KnowledgeUploadPathError);
    expect(() => assertSafeKnowledgeRepoPath("scripts/backboard-bootstrap.ts")).toThrow(KnowledgeUploadPathError);
  });
});

describe("unknown tools are rejected by the dispatcher, never silently executed", () => {
  beforeEach(() => {
    process.env.BACKBOARD_MOCK_MODE = "true";
    resetBackboardAdapterForTests();
  });

  it("returns ok: false for an unknown tool name instead of throwing or executing anything", async () => {
    const adapter = getBackboardAdapter();
    const context = createRunContext(FLAGSHIP_SCENARIO_ID, adapter);
    const outcome = await dispatchToolCall(
      { id: "call-1", name: "drop_all_tables", arguments: {}, rawArguments: "{}" },
      context,
      "a1",
    );
    expect(outcome.ok).toBe(false);
    expect((outcome.output as { error: string }).error).toContain("Unknown tool");
  });

  it("also rejects a battery/GridTwin-era tool name that no longer exists", async () => {
    const adapter = getBackboardAdapter();
    const context = createRunContext(FLAGSHIP_SCENARIO_ID, adapter);
    const outcome = await dispatchToolCall(
      { id: "call-2", name: "validate_dispatch_plan", arguments: {}, rawArguments: "{}" },
      context,
      "a1",
    );
    expect(outcome.ok).toBe(false);
  });
});

describe("POST /api/backboard/run: request size and shape limits", () => {
  beforeEach(async () => {
    process.env.BACKBOARD_MOCK_MODE = "true";
    const { resetBackboardAdapterForTests: resetAdapter } = await import("@/lib/backboard/adapter");
    const { resetAssistantManifestForTests } = await import("@/lib/backboard/assistant-manifest");
    const { resetRunRateLimiterForTests } = await import("@/lib/backboard/run-rate-limit");
    resetAdapter();
    resetAssistantManifestForTests();
    resetRunRateLimiterForTests();
  });

  function jsonRequest(body: unknown): Request {
    return new Request("http://localhost/api/backboard/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  it("rejects a request body over the documented size limit with 413", async () => {
    const { POST } = await import("@/app/api/backboard/run/route");
    const response = await POST(
      jsonRequest({ scenarioId: FLAGSHIP_SCENARIO_ID, padding: "x".repeat(25_000) }),
    );
    expect(response.status).toBe(413);
  });

  it("rejects an oversized scenarioId string with 400 rather than passing it through", async () => {
    const { POST } = await import("@/app/api/backboard/run/route");
    const response = await POST(jsonRequest({ scenarioId: "a".repeat(500) }));
    expect(response.status).toBe(400);
  });

  it("rejects a request body that is not valid JSON with 400", async () => {
    const { POST } = await import("@/app/api/backboard/run/route");
    const response = await POST(jsonRequest("{not valid json"));
    expect(response.status).toBe(400);
  });

  it("rejects an unrecognized top-level field via the strict request schema", async () => {
    const { POST } = await import("@/app/api/backboard/run/route");
    const response = await POST(jsonRequest({ scenarioId: FLAGSHIP_SCENARIO_ID, assetId: "should-not-exist" }));
    expect(response.status).toBe(400);
  });
});
