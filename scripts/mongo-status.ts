/**
 * Pings MongoDB Atlas using MONGODB_URI from .env and prints connection
 * status (host, database, collection names). Never prints the URI or password.
 *
 * Usage: npm run mongo:status
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function loadDotEnv(repoRoot: string): void {
  for (const filename of [".env.local", ".env"]) {
    const filePath = path.join(repoRoot, filename);
    if (!existsSync(filePath)) continue;
    const lines = readFileSync(filePath, "utf-8").split("\n");
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}

const repoRoot = path.resolve(__dirname, "..");
loadDotEnv(repoRoot);

async function main(): Promise<void> {
  const { isMongoConfigured, getMongoDatabaseName, getMongoSearchIndex, getMongoVectorIndex } =
    await import("@/lib/mongodb/env");
  const { pingMongo, closeMongoClient } = await import("@/lib/mongodb/client");

  const repoProvider = process.env.TECHTO_REPOSITORY_PROVIDER?.trim() || "fixture";

  console.log("TechTO / MongoDB status");
  console.log("========================");
  console.log(`URI configured:    ${isMongoConfigured() ? "yes" : "no"} (value never printed)`);
  console.log(`Database:          ${getMongoDatabaseName()}`);
  console.log(`Search index:      ${getMongoSearchIndex()}`);
  console.log(`Vector index:      ${getMongoVectorIndex()}`);
  console.log(`Repo provider:     ${repoProvider}`);

  if (!isMongoConfigured()) {
    console.log("\nStatus:             NOT CONFIGURED");
    console.log("Set MONGODB_URI in .env (see .env.example), then re-run.");
    process.exitCode = 1;
    return;
  }

  try {
    const result = await pingMongo();
    console.log(`Host:              ${result.host}`);
    console.log(`Ping:              ${result.ok ? "ok" : "failed"}`);
    console.log(
      `Collections:       ${result.collections.length === 0 ? "(none yet)" : result.collections.join(", ")}`,
    );
    console.log("\nStatus:             CONNECTED");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`\nStatus:             FAILED`);
    console.log(`Error:             ${message}`);
    console.log(
      "\nCheck: Atlas Network Access allows your IP, and the database user/password are correct.",
    );
    process.exitCode = 1;
  } finally {
    await closeMongoClient();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
