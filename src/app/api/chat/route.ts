import { createEmptyChatThread, handleChatMessage } from "@/lib/chat/service";
import { postChatMessageSchema } from "@/lib/chat/schemas";
import { errorMessage, jsonError } from "@/lib/backboard/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Create a new City Copilot thread (GET) or post a message (POST). */
export async function GET() {
  try {
    const thread = await createEmptyChatThread();
    return Response.json({ thread });
  } catch (error) {
    return jsonError("Failed to create chat thread.", 500, { detail: errorMessage(error) });
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = postChatMessageSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("Invalid request body.", 400, { issues: parsed.error.issues });
  }

  try {
    const result = await handleChatMessage(parsed.data);
    return Response.json(result);
  } catch (error) {
    return jsonError("Failed to handle chat message.", 500, { detail: errorMessage(error) });
  }
}
