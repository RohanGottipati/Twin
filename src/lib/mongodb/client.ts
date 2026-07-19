import { MongoClient, type Db } from "mongodb";

import {
  getMongoDatabaseName,
  requireMongoUri,
} from "@/lib/mongodb/env";
import { assertServerOnly } from "@/lib/backboard/env";

/**
 * Cached MongoClient for the Next.js / Node process. Atlas recommends a
 * single shared client rather than opening a new connection per request.
 * Server-only: never import this module from client components.
 */
let cachedClient: MongoClient | null = null;
let connectPromise: Promise<MongoClient> | null = null;

export async function getMongoClient(): Promise<MongoClient> {
  assertServerOnly("MongoDB client");

  if (cachedClient) return cachedClient;
  if (connectPromise) return connectPromise;

  const uri = requireMongoUri();
  const client = new MongoClient(uri, {
    appName: "TechTO",
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 10_000,
  });

  connectPromise = client
    .connect()
    .then((connected) => {
      cachedClient = connected;
      return connected;
    })
    .catch((error) => {
      connectPromise = null;
      throw error;
    });

  return connectPromise;
}

export async function getMongoDb(databaseName?: string): Promise<Db> {
  const client = await getMongoClient();
  return client.db(databaseName ?? getMongoDatabaseName());
}

/** Ping Atlas and return basic cluster metadata (no secrets). */
export async function pingMongo(): Promise<{
  ok: boolean;
  database: string;
  host: string;
  collections: string[];
}> {
  const uri = requireMongoUri();
  const database = getMongoDatabaseName();
  const client = await getMongoClient();
  const db = client.db(database);

  const ping = await db.command({ ping: 1 });
  const collections = (await db.listCollections().toArray()).map((c) => c.name);

  let host = "atlas";
  try {
    const parsed = new URL(uri.replace("mongodb+srv://", "https://"));
    host = parsed.hostname;
  } catch {
    // leave generic host label
  }

  return {
    ok: ping.ok === 1,
    database,
    host,
    collections,
  };
}

/** Test-only / graceful shutdown: close the shared client. */
export async function closeMongoClient(): Promise<void> {
  if (cachedClient) {
    await cachedClient.close();
  }
  cachedClient = null;
  connectPromise = null;
}
