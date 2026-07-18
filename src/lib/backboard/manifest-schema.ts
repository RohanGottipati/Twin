import type { TwinTOAssistantKey } from "@/lib/backboard/assistants";
import { TWINTO_ASSISTANT_KEYS } from "@/lib/backboard/assistants";
import type { ResolvedAssistant } from "@/lib/backboard/assistant-manifest";

/**
 * Schema version for `.backboard/assistant-manifest.local.json`.
 * v3 introduces rosterVersion consolidated-16 and a keyed assistants map.
 */
export const MANIFEST_SCHEMA_VERSION = 3;

export const MANIFEST_PRODUCT = "twinto";

export const MANIFEST_ROSTER_VERSION = "consolidated-16";

export interface AssistantManifestEntry {
  role: TwinTOAssistantKey;
  name: string;
  assistantId: string;
  toolCount: number;
  memory: string;
  model: {
    provider: string;
    name: string;
    contextLimit: number;
  };
}

export interface AssistantManifestFile {
  schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
  product: typeof MANIFEST_PRODUCT;
  rosterVersion: typeof MANIFEST_ROSTER_VERSION;
  createdAt: string;
  assistantCount: number;
  assistants: Record<TwinTOAssistantKey, AssistantManifestEntry>;
}

export function buildAssistantManifestFile(
  manifest: Map<TwinTOAssistantKey, ResolvedAssistant> | ResolvedAssistant[],
): AssistantManifestFile {
  const resolved = manifest instanceof Map ? Array.from(manifest.values()) : manifest;
  const assistants = {} as Record<TwinTOAssistantKey, AssistantManifestEntry>;

  for (const entry of resolved) {
    const key = entry.role.key;
    assistants[key] = {
      role: key,
      name: entry.role.name,
      assistantId: entry.record.assistantId,
      toolCount: entry.role.toolNames.length,
      memory: entry.role.memory,
      model: {
        provider: entry.model.provider,
        name: entry.model.modelName,
        contextLimit: entry.model.contextLimit,
      },
    };
  }

  for (const key of TWINTO_ASSISTANT_KEYS) {
    if (!assistants[key]) {
      throw new Error(`Manifest is missing required assistant key "${key}".`);
    }
  }

  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    product: MANIFEST_PRODUCT,
    rosterVersion: MANIFEST_ROSTER_VERSION,
    createdAt: new Date().toISOString(),
    assistantCount: TWINTO_ASSISTANT_KEYS.length,
    assistants,
  };
}
