import { describe, expect, it } from "vitest";

import { ASSISTANT_ROSTER, TECHTO_ASSISTANT_KEYS } from "@/lib/backboard/assistants";
import {
  MANIFEST_PRODUCT,
  MANIFEST_ROSTER_VERSION,
  MANIFEST_SCHEMA_VERSION,
  buildAssistantManifestFile,
} from "@/lib/backboard/manifest-schema";
import type { ResolvedAssistant } from "@/lib/backboard/assistant-manifest";

function fakeResolved(): ResolvedAssistant[] {
  return TECHTO_ASSISTANT_KEYS.map((key, index) => ({
    role: ASSISTANT_ROSTER[key],
    record: {
      assistantId: `mock-${key}`,
      name: ASSISTANT_ROSTER[key].name,
      systemPrompt: ASSISTANT_ROSTER[key].systemPrompt,
      tools: [],
      createdAt: "2026-07-18T00:00:00.000Z",
    },
    model: {
      provider: "mock",
      modelName: `model-${index}`,
      contextLimit: 128000,
      reason: "test",
    },
  }));
}

describe("manifest schema v4 principled-11", () => {
  it("builds a principled-11 keyed manifest", () => {
    const file = buildAssistantManifestFile(fakeResolved());
    expect(file.schemaVersion).toBe(MANIFEST_SCHEMA_VERSION);
    expect(file.schemaVersion).toBe(4);
    expect(file.product).toBe(MANIFEST_PRODUCT);
    expect(file.rosterVersion).toBe(MANIFEST_ROSTER_VERSION);
    expect(file.assistantCount).toBe(11);
    expect(Object.keys(file.assistants)).toHaveLength(11);
    expect(file.assistants["final-policy-judge"].assistantId).toBe("mock-final-policy-judge");
    expect(file.createdAt).toMatch(/^\d{4}-/);
  });

  it("rejects manifests missing a required key", () => {
    const partial = fakeResolved().slice(0, 10);
    expect(() => buildAssistantManifestFile(partial)).toThrow(/missing required assistant key/);
  });
});
