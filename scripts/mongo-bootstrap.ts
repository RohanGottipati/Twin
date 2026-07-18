/**
 * Creates TwinTO MongoDB collections/indexes and seeds demo fixtures from
 * src/data/transit. Idempotent. Never prints MONGODB_URI or passwords.
 *
 * Usage: npm run mongo:bootstrap
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
  const { isMongoConfigured, getMongoDatabaseName } = await import("@/lib/mongodb/env");
  const { bootstrapMongoCollections } = await import("@/lib/mongodb/bootstrap");
  const { seedMongoFromFixtures } = await import("@/lib/mongodb/seed");
  const { closeMongoClient } = await import("@/lib/mongodb/client");

  console.log("TwinTO / MongoDB bootstrap");
  console.log("==========================");
  console.log(`URI configured:    ${isMongoConfigured() ? "yes" : "no"} (value never printed)`);
  console.log(`Database:          ${getMongoDatabaseName()}`);

  if (!isMongoConfigured()) {
    console.log("\nStatus:             NOT CONFIGURED");
    console.log("Set MONGODB_URI in .env, then re-run.");
    process.exitCode = 1;
    return;
  }

  try {
    const boot = await bootstrapMongoCollections();
    console.log(`Collections:       ${boot.collections.length} present`);
    console.log(`Time-series:       ${boot.timeSeries.join(", ")}`);

    const seed = await seedMongoFromFixtures();
    console.log("\nSeed upserts:");
    for (const [collection, count] of Object.entries(seed.upserted)) {
      console.log(`  ${collection.padEnd(28)} ${count}`);
    }

    console.log("\nStatus:             BOOTSTRAPPED");
    console.log("Set TWINTO_REPOSITORY_PROVIDER=mongo so agents read from Atlas.");
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
