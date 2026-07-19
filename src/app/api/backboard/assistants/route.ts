import { NextResponse } from "next/server";

import { getBackboardAdapter } from "@/lib/backboard/adapter";
import { getAssistantManifest } from "@/lib/backboard/assistant-manifest";
import { INTENT_BUNDLES, TECHTO_ASSISTANT_KEYS, listAssistantRoles } from "@/lib/backboard/assistants";
import {
  MANIFEST_PRODUCT,
  MANIFEST_ROSTER_VERSION,
  MANIFEST_SCHEMA_VERSION,
} from "@/lib/backboard/manifest-schema";
import { errorMessage, jsonError } from "@/lib/backboard/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lists the TechTO consolidated assistant roster and resolved Backboard ids.
 */
export async function GET() {
  try {
    const adapter = getBackboardAdapter();
    const manifest = await getAssistantManifest(adapter);

    const assistants = listAssistantRoles().map((role) => {
      const resolved = manifest.get(role.key);
      return {
        key: role.key,
        name: role.name,
        description: role.shortDescription,
        assistantId: resolved?.record.assistantId ?? null,
        toolNames: role.toolNames,
        memory: role.memory,
        uiGroup: role.uiGroup,
      };
    });

    return NextResponse.json({
      product: MANIFEST_PRODUCT,
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      rosterVersion: MANIFEST_ROSTER_VERSION,
      mode: adapter.mode,
      assistantCount: assistants.length,
      expectedKeys: TECHTO_ASSISTANT_KEYS,
      intentBundles: INTENT_BUNDLES,
      assistants,
    });
  } catch (error) {
    console.error("Failed to list TechTO assistants:", error);
    return jsonError("Failed to list TechTO assistants.", 500, { detail: errorMessage(error) });
  }
}
