import { getMongoDb } from "@/lib/mongodb/client";
import { COLLECTIONS } from "@/lib/mongodb/collections";
import { getMongoSearchIndex, isMongoConfigured } from "@/lib/mongodb/env";

export interface SearchHit {
  collection: string;
  id: string;
  score: number;
  label: string;
  snippet: string;
}

/**
 * Prefer Atlas Search ($search) when the named index exists; otherwise fall
 * back to case-insensitive regex across key demo collections so local/demo
 * paths keep working without Atlas Search setup.
 */
export async function searchTechTO(query: string, limit = 10): Promise<{
  mode: "atlas-search" | "regex-fallback";
  hits: SearchHit[];
}> {
  if (!isMongoConfigured()) return { mode: "regex-fallback", hits: [] };
  const q = query.trim();
  if (!q) return { mode: "regex-fallback", hits: [] };

  const db = await getMongoDb();
  const indexName = getMongoSearchIndex();

  try {
    const atlasHits = await db
      .collection(COLLECTIONS.documents)
      .aggregate([
        {
          $search: {
            index: indexName,
            text: { query: q, path: ["title", "body", "tags"] },
          },
        },
        { $limit: limit },
        {
          $project: {
            _id: 0,
            id: { $ifNull: ["$documentId", "$_id"] },
            title: 1,
            body: 1,
            score: { $meta: "searchScore" },
          },
        },
      ])
      .toArray();

    if (atlasHits.length > 0) {
      return {
        mode: "atlas-search",
        hits: atlasHits.map((doc) => ({
          collection: COLLECTIONS.documents,
          id: String(doc.id),
          score: Number(doc.score ?? 0),
          label: String(doc.title ?? doc.id),
          snippet: String(doc.body ?? "").slice(0, 240),
        })),
      };
    }
  } catch {
    // Index missing or tier without Atlas Search: use regex fallback.
  }

  const pattern = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const hits: SearchHit[] = [];

  const neighbourhoods = await db
    .collection(COLLECTIONS.neighbourhoods)
    .find({ $or: [{ name: pattern }, { tags: pattern }, { landUse: pattern }] })
    .limit(limit)
    .toArray();
  for (const doc of neighbourhoods) {
    hits.push({
      collection: COLLECTIONS.neighbourhoods,
      id: String(doc.neighbourhoodId),
      score: 1,
      label: String(doc.name),
      snippet: String(doc.landUse ?? ""),
    });
  }

  const routes = await db
    .collection(COLLECTIONS.transitRoutes)
    .find({ $or: [{ name: pattern }, { routeId: pattern }] })
    .limit(limit)
    .toArray();
  for (const doc of routes) {
    hits.push({
      collection: COLLECTIONS.transitRoutes,
      id: String(doc.routeId),
      score: 1,
      label: String(doc.name),
      snippet: `${doc.mode} · capacity ${doc.vehicleCapacity}`,
    });
  }

  const stops = await db
    .collection(COLLECTIONS.transitStops)
    .find({ $or: [{ name: pattern }, { stopId: pattern }] })
    .limit(limit)
    .toArray();
  for (const doc of stops) {
    hits.push({
      collection: COLLECTIONS.transitStops,
      id: String(doc.stopId),
      score: 1,
      label: String(doc.name),
      snippet: `route ${doc.routeId}`,
    });
  }

  const similar = await db
    .collection(COLLECTIONS.similarInterventions)
    .find({ $or: [{ title: pattern }, { summary: pattern }, { tags: pattern }] })
    .limit(limit)
    .toArray();
  for (const doc of similar) {
    hits.push({
      collection: COLLECTIONS.similarInterventions,
      id: String(doc.interventionId),
      score: 1,
      label: String(doc.title),
      snippet: String(doc.summary ?? "").slice(0, 240),
    });
  }

  return { mode: "regex-fallback", hits: hits.slice(0, limit) };
}
