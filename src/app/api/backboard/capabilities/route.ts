import { NextResponse } from "next/server";

import { getBackboardAdapter } from "@/lib/backboard/adapter";
import { getAssistantManifest } from "@/lib/backboard/assistant-manifest";
import { TWINTO_ASSISTANT_KEYS } from "@/lib/backboard/assistants";
import { MANIFEST_ROSTER_VERSION, MANIFEST_SCHEMA_VERSION } from "@/lib/backboard/manifest-schema";
import { errorMessage, jsonError } from "@/lib/backboard/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only introspection endpoint: which TwinTO assistants are configured,
 * which tools/memory/thinking settings each uses, and which model Backboard's
 * capability catalog resolved for each one. Used by the TwinTO UI status
 * panel and by developers to sanity-check model routing.
 */
export async function GET() {
  try {
    const adapter = getBackboardAdapter();
    const manifest = await getAssistantManifest(adapter);
    const models = await adapter.listModels();

    const assistants = Array.from(manifest.values()).map((resolved) => ({
      role: resolved.role.key,
      name: resolved.role.name,
      description: resolved.role.shortDescription,
      assistantId: resolved.record.assistantId,
      toolNames: resolved.role.toolNames,
      memory: resolved.role.memory,
      thinking: resolved.role.thinking ?? null,
      model: {
        provider: resolved.model.provider,
        name: resolved.model.modelName,
        contextLimit: resolved.model.contextLimit,
        reason: resolved.model.reason,
      },
    }));

    const configuredKeys = new Set(assistants.map((assistant) => assistant.role));
    const missingAssistants = TWINTO_ASSISTANT_KEYS.filter((key) => !configuredKeys.has(key));

    return NextResponse.json({
      product: "twinto",
      rosterVersion: MANIFEST_ROSTER_VERSION,
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      expectedAssistants: TWINTO_ASSISTANT_KEYS.length,
      configuredAssistants: assistants.length,
      missingAssistants,
      mode: adapter.mode,
      citizenReactionProvider: process.env.TWINTO_CITIZEN_REACTION_PROVIDER?.trim() || "mock",
      repositoryProvider: process.env.TWINTO_REPOSITORY_PROVIDER?.trim() || "fixture",
      mongoConfigured: Boolean(process.env.MONGODB_URI?.trim()),
      mongoDatabase: process.env.MONGODB_DATABASE?.trim() || "twinto",
      geographicScope: {
        cityId: "toronto",
        label: "City of Toronto only",
        note: "All fixtures, map actions, and agent suggestions must stay inside Toronto.",
      },
      modelCatalogSize: models.length,
      assistants,
    });
  } catch (error) {
    console.error("Failed to resolve Backboard capabilities:", error);
    return jsonError("Failed to resolve Backboard capabilities.", 500, { detail: errorMessage(error) });
  }
}
