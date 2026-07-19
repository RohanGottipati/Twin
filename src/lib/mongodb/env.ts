import { assertServerOnly } from "@/lib/backboard/env";

const DEFAULT_DATABASE = "techto";

export class MongoConfigError extends Error {}

export function getMongoUri(): string {
  assertServerOnly("MongoDB env");
  return process.env.MONGODB_URI?.trim() ?? "";
}

export function getMongoDatabaseName(): string {
  assertServerOnly("MongoDB env");
  return process.env.MONGODB_DATABASE?.trim() || DEFAULT_DATABASE;
}

export function getMongoSearchIndex(): string {
  assertServerOnly("MongoDB env");
  return process.env.MONGODB_SEARCH_INDEX?.trim() || "techto-search";
}

export function getMongoVectorIndex(): string {
  assertServerOnly("MongoDB env");
  return process.env.MONGODB_VECTOR_INDEX?.trim() || "techto-memory-vector";
}

/** True when a URI is present. Does not assert server-only (safe for gated no-ops). */
export function isMongoConfigured(): boolean {
  return Boolean(process.env.MONGODB_URI?.trim());
}

export function requireMongoUri(): string {
  const uri = getMongoUri();
  if (!uri) {
    throw new MongoConfigError(
      "MONGODB_URI is not set. Add it to .env (see .env.example).",
    );
  }
  return uri;
}

/** Prefer MONGODB_URI_READONLY for agent code; fall back to MONGODB_URI. */
export function getMongoReadonlyUri(): string {
  assertServerOnly("MongoDB env");
  return process.env.MONGODB_URI_READONLY?.trim() || getMongoUri();
}
