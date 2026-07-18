import { NextResponse } from "next/server";
import { z } from "zod";

import { getBackboardAdapter } from "@/lib/backboard/adapter";
import { resolveAssistant } from "@/lib/backboard/assistant-manifest";
import { errorMessage, isAssistantRoleKey, jsonError } from "@/lib/backboard/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_ROLE = "explanation-map-action-agent";

/** List an assistant's curated long-term memories. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const assistantRole = url.searchParams.get("assistantRole") ?? DEFAULT_ROLE;
  if (!isAssistantRoleKey(assistantRole)) {
    return jsonError(`Unknown assistantRole "${assistantRole}".`, 400);
  }

  try {
    const adapter = getBackboardAdapter();
    const resolved = await resolveAssistant(assistantRole, adapter);
    const memories = await adapter.listMemories(resolved.record.assistantId);
    return NextResponse.json({ assistantRole, memories });
  } catch (error) {
    return jsonError(errorMessage(error), 500);
  }
}

const addMemorySchema = z.object({
  assistantRole: z.string().min(1).default(DEFAULT_ROLE),
  content: z.string().min(1).max(2000),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Explicit curated write, meant to be called only from an operator-approved
 * UI action after a run completes. Every run itself uses memory: "Readonly",
 * so nothing is ever written silently mid-run.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = addMemorySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("Invalid request body.", 400, { issues: parsed.error.issues });
  }

  const { assistantRole, content, metadata } = parsed.data;
  if (!isAssistantRoleKey(assistantRole)) {
    return jsonError(`Unknown assistantRole "${assistantRole}".`, 400);
  }

  try {
    const adapter = getBackboardAdapter();
    const resolved = await resolveAssistant(assistantRole, adapter);
    const memory = await adapter.addMemory(resolved.record.assistantId, content, metadata);
    return NextResponse.json({ assistantRole, memory }, { status: 201 });
  } catch (error) {
    return jsonError(errorMessage(error), 500);
  }
}

/** Wipes ALL memories for an assistant. Requires an explicit ?confirm=true to guard against accidental resets. */
export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const assistantRole = url.searchParams.get("assistantRole") ?? DEFAULT_ROLE;
  const confirm = url.searchParams.get("confirm");

  if (!isAssistantRoleKey(assistantRole)) {
    return jsonError(`Unknown assistantRole "${assistantRole}".`, 400);
  }
  if (confirm !== "true") {
    return jsonError("Pass ?confirm=true to reset all memories for this assistant.", 400);
  }

  try {
    const adapter = getBackboardAdapter();
    const resolved = await resolveAssistant(assistantRole, adapter);
    await adapter.resetMemories(resolved.record.assistantId);
    return NextResponse.json({ assistantRole, reset: true });
  } catch (error) {
    return jsonError(errorMessage(error), 500);
  }
}
