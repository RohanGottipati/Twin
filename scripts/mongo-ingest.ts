/**
 * Offline-first TechTO ingest pipeline into MongoDB Atlas.
 * Usage: npm run mongo:ingest
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function loadDotEnv(repoRoot: string): void {
  for (const filename of [".env.local", ".env"]) {
    const filePath = path.join(repoRoot, filename);
    if (!existsSync(filePath)) continue;
    for (const rawLine of readFileSync(filePath, "utf-8").split("\n")) {
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
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

const repoRoot = path.resolve(__dirname, "..");
loadDotEnv(repoRoot);

async function main(): Promise<void> {
  const { runOfflineIngestPipeline } = await import("@/lib/mongodb/ingest");
  const { closeMongoClient } = await import("@/lib/mongodb/client");

  console.log("TechTO / MongoDB ingest");
  console.log("=======================");
  try {
    const result = await runOfflineIngestPipeline();
    console.log(`Ingest id: ${result.ingestId}`);
    for (const step of result.steps) {
      console.log(`  [${step.ok ? "ok" : "FAIL"}] ${step.step}: ${step.detail}`);
    }
    if (result.steps.some((step) => !step.ok)) process.exitCode = 1;
  } finally {
    await closeMongoClient();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
