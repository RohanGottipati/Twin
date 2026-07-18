import { NextResponse } from "next/server";
import { z } from "zod";

import { getBackboardAdapter } from "@/lib/backboard/adapter";
import { resolveAssistant } from "@/lib/backboard/assistant-manifest";
import { errorMessage, isAssistantRoleKey, jsonError } from "@/lib/backboard/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: { memoryId: string };
}

const updateSchema = z.object({
  assistantRole: z.string().min(1).default("explanation-map-action-agent"),
  content: z.string().min(1).max(2000),
});

export async function PUT(request: Request, { params }: RouteParams) {
  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("Invalid request body.", 400, { issues: parsed.error.issues });
  }

  const { assistantRole, content } = parsed.data;
  if (!isAssistantRoleKey(assistantRole)) {
    return jsonError(`Unknown assistantRole "${assistantRole}".`, 400);
  }

  try {
    const adapter = getBackboardAdapter();
    const resolved = await resolveAssistant(assistantRole, adapter);
    const memory = await adapter.updateMemory(resolved.record.assistantId, params.memoryId, content);
    return NextResponse.json({ assistantRole, memory });
  } catch (error) {
    return jsonError(errorMessage(error), 500);
  }
}

export async function DELETE(request: Request, { params }: RouteParams) {
  const url = new URL(request.url);
  const assistantRole = url.searchParams.get("assistantRole") ?? "explanation-map-action-agent";
  if (!isAssistantRoleKey(assistantRole)) {
    return jsonError(`Unknown assistantRole "${assistantRole}".`, 400);
  }

  try {
    const adapter = getBackboardAdapter();
    const resolved = await resolveAssistant(assistantRole, adapter);
    await adapter.deleteMemory(resolved.record.assistantId, params.memoryId);
    return NextResponse.json({ assistantRole, deleted: true });
  } catch (error) {
    return jsonError(errorMessage(error), 500);
  }
}
