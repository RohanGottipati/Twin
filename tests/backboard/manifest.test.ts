import { beforeEach, describe, expect, it } from "vitest";

import { MANIFEST_PRODUCT, MANIFEST_SCHEMA_VERSION, buildAssistantManifestFile } from "@/lib/backboard/manifest-schema";
import { getAssistantManifest, resetAssistantManifestForTests } from "@/lib/backboard/assistant-manifest";
import { getBackboardAdapter, resetBackboardAdapterForTests } from "@/lib/backboard/adapter";
import { clearModelRouterCacheForTests } from "@/lib/backboard/model-router";
import { ASSISTANT_ROSTER } from "@/lib/backboard/assistants";

describe("manifest-schema constants", () => {
  it("declares schemaVersion 2 for the twinto product", () => {
    expect(MANIFEST_SCHEMA_VERSION).toBe(2);
    expect(MANIFEST_PRODUCT).toBe("twinto");
  });
});

describe("buildAssistantManifestFile", () => {
  beforeEach(() => {
    process.env.BACKBOARD_MOCK_MODE = "true";
    resetBackboardAdapterForTests();
    resetAssistantManifestForTests();
    clearModelRouterCacheForTests();
  });

  it("builds a schemaVersion 2 / product twinto snapshot from the resolved assistant manifest", async () => {
    const adapter = getBackboardAdapter();
    const manifest = await getAssistantManifest(adapter);
    const file = buildAssistantManifestFile(manifest);

    expect(file.schemaVersion).toBe(2);
    expect(file.product).toBe("twinto");
    expect(file.assistantCount).toBe(Object.keys(ASSISTANT_ROSTER).length);
    expect(file.assistants).toHaveLength(Object.keys(ASSISTANT_ROSTER).length);
    expect(typeof file.generatedAt).toBe("string");
    expect(new Date(file.generatedAt).toString()).not.toBe("Invalid Date");
  });

  it("includes assistantId, tool count, memory, and model for every entry", async () => {
    const adapter = getBackboardAdapter();
    const manifest = await getAssistantManifest(adapter);
    const file = buildAssistantManifestFile(manifest);

    const judge = file.assistants.find((entry) => entry.role === "final-policy-judge");
    expect(judge).toBeDefined();
    expect(judge!.assistantId).toBeTruthy();
    expect(judge!.toolCount).toBeGreaterThan(0);
    expect(judge!.memory).toBe("Readonly");
    expect(judge!.model.provider).toBeTruthy();
    expect(judge!.model.name).toBeTruthy();
  });

  it("sorts assistants by role key for a stable diff-friendly file", async () => {
    const adapter = getBackboardAdapter();
    const manifest = await getAssistantManifest(adapter);
    const file = buildAssistantManifestFile(manifest);
    const roles = file.assistants.map((entry) => entry.role);
    expect(roles).toEqual([...roles].sort());
  });

  it("also accepts a plain array of resolved assistants, not just a Map", async () => {
    const adapter = getBackboardAdapter();
    const manifest = await getAssistantManifest(adapter);
    const asArray = Array.from(manifest.values());
    const fileFromArray = buildAssistantManifestFile(asArray);
    const fileFromMap = buildAssistantManifestFile(manifest);
    expect(fileFromArray.assistants).toEqual(fileFromMap.assistants);
  });
});
