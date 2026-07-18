import { getChatThread } from "@/lib/chat/service";
import { errorMessage, jsonError } from "@/lib/backboard/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ threadId: string }> | { threadId: string } },
) {
  try {
    const params = await Promise.resolve(context.params);
    const thread = await getChatThread(params.threadId);
    if (!thread) return jsonError("Chat thread not found.", 404);
    return Response.json({ thread });
  } catch (error) {
    return jsonError("Failed to load chat thread.", 500, { detail: errorMessage(error) });
  }
}
