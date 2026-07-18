import { beforeEach, describe, expect, it } from "vitest";

describe("GET /api/backboard/capabilities", () => {
  beforeEach(async () => {
    process.env.BACKBOARD_MOCK_MODE = "true";
    const { resetBackboardAdapterForTests } = await import("@/lib/backboard/adapter");
    const { resetAssistantManifestForTests } = await import("@/lib/backboard/assistant-manifest");
    resetBackboardAdapterForTests();
    resetAssistantManifestForTests();
  });

  it("returns TwinTO's full assistant roster with mock-mode info and resolved models", async () => {
    const { GET } = await import("@/app/api/backboard/capabilities/route");
    const response = await GET();
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.mode).toBe("mock");
    expect(body.assistants).toHaveLength(54);
    expect(body.modelCatalogSize).toBeGreaterThan(0);

    const judge = body.assistants.find((a: { role: string }) => a.role === "final-policy-judge");
    expect(judge).toBeDefined();
    expect(judge.assistantId).toBe("mock-assistant-twinto-final-policy-judge");
    expect(judge.toolNames).toContain("compare_interventions");
    expect(judge.memory).toBe("Readonly");
    expect(judge.model.provider).toBeTruthy();
    expect(judge.model.name).toBeTruthy();
    expect(judge.thinking).toEqual({ effort: "high" });
  });

  it("never surfaces a GridTwin/battery role in the capabilities response", async () => {
    const { GET } = await import("@/app/api/backboard/capabilities/route");
    const body = await (await GET()).json();
    for (const assistant of body.assistants as { name: string }[]) {
      expect(assistant.name).not.toMatch(/gridtwin/i);
    }
  });
});
