/**
 * Prints the resolved TechTO/Backboard capabilities: live mode, base URL,
 * assistant roster with tools/memory/model selection. Never prints
 * BACKBOARD_API_KEY; only reports whether one is configured.
 *
 * Usage: npm run backboard:status
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
  const { getBackboardApiKey, getBackboardBaseUrl } = await import("@/lib/backboard/env");
  const { getBackboardAdapter } = await import("@/lib/backboard/adapter");
  const { getAssistantManifest } = await import("@/lib/backboard/assistant-manifest");

  const hasKey = getBackboardApiKey().length > 0;

  console.log("TechTO / Backboard status");
  console.log("==========================");
  console.log(`Mode:              LIVE`);
  console.log(`Base URL:          ${getBackboardBaseUrl()}`);
  console.log(`API key present:   ${hasKey ? "yes" : "no"} (value never printed)`);
  console.log("");

  const adapter = getBackboardAdapter();
  const [manifest, models] = await Promise.all([
    getAssistantManifest(adapter),
    adapter.listModels(),
  ]);

  console.log(`Model catalog size: ${models.length}`);
  console.log("");
  console.log("Assistant roster:");
  for (const [key, resolved] of manifest) {
    console.log(`  - ${key}`);
    console.log(`      name:        ${resolved.record.name}`);
    console.log(`      assistantId: ${resolved.record.assistantId}`);
    console.log(`      tools:       ${resolved.role.toolNames.join(", ") || "(none)"}`);
    console.log(`      memory:      ${resolved.role.memory}`);
    console.log(
      `      thinking:    ${resolved.role.thinking ? `effort=${resolved.role.thinking.effort ?? "default"}` : "(none)"}`,
    );
    console.log(`      model:       ${resolved.model.provider}/${resolved.model.modelName} (context=${resolved.model.contextLimit})`);
    console.log(
      `      knowledge:   ${resolved.role.knowledgeDocuments.map((doc) => doc.filename).join(", ") || "(none)"}`,
    );
  }
}

main().catch((error: unknown) => {
  console.error("Backboard status check failed:");
  console.error(error);
  process.exitCode = 1;
});
