import { NextResponse } from "next/server";
import { z } from "zod";

import { getBackboardAdapter } from "@/lib/backboard/adapter";
import { resolveAssistant } from "@/lib/backboard/assistant-manifest";
import { errorMessage, isAssistantRoleKey, jsonError } from "@/lib/backboard/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const searchSchema = z.object({
  assistantRole: z.string().min(1).default("explanation-map-action-agent"),
  query: z.string().min(1),
  limit: z.number().int().positive().max(50).optional(),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = searchSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("Invalid request body.", 400, { issues: parsed.error.issues });
  }

  const { assistantRole, query, limit } = parsed.data;
  if (!isAssistantRoleKey(assistantRole)) {
    return jsonError(`Unknown assistantRole "${assistantRole}".`, 400);
  }

  try {
    const adapter = getBackboardAdapter();
    const resolved = await resolveAssistant(assistantRole, adapter);
    const memories = await adapter.searchMemories(resolved.record.assistantId, query, limit);
    return NextResponse.json({ assistantRole, memories });
  } catch (error) {
    return jsonError(errorMessage(error), 500);
  }
}
