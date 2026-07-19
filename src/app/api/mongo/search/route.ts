import { errorMessage, jsonError } from "@/lib/backboard/route-helpers";
import { isMongoConfigured } from "@/lib/mongodb/env";
import { searchTechTO } from "@/lib/mongodb/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Searches TechTO operational collections (Atlas Search when available,
 * regex fallback otherwise).
 */
export async function GET(request: Request) {
  if (!isMongoConfigured()) {
    return jsonError("MongoDB is not configured.", 503);
  }

  try {
    const url = new URL(request.url);
    const q = url.searchParams.get("q") ?? "";
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 10) || 10, 50);
    const result = await searchTechTO(q, limit);
    return Response.json(result);
  } catch (error) {
    return jsonError("Search failed.", 500, { detail: errorMessage(error) });
  }
}
