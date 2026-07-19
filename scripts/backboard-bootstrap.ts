/**
 * Resolves the TechTO 54-assistant roster against Backboard (creating or
 * updating each named assistant) and uploads each role's knowledge
 * documents. Safe to re-run: assistant upsert is idempotent by name, but
 * document upload is not (Backboard exposes no per-assistant document list
 * to dedupe against), so only run this when you actually want to (re)seed
 * documents.
 *
 * Usage: npm run backboard:bootstrap
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  const { getBackboardBaseUrl } = await import("@/lib/backboard/env");
  const { getBackboardAdapter } = await import("@/lib/backboard/adapter");
  const { getAssistantManifest } = await import("@/lib/backboard/assistant-manifest");
  const { uploadKnowledgeDocuments } = await import("@/lib/backboard/knowledge-upload");
  const { buildAssistantManifestFile } = await import("@/lib/backboard/manifest-schema");

  console.log(`Backboard mode: LIVE`);
  console.log(`Base URL: ${getBackboardBaseUrl()}`);
  console.log("");

  const adapter = getBackboardAdapter();
  const manifest = await getAssistantManifest(adapter);

  console.log("Assistant roster:");
  for (const [key, resolved] of manifest) {
    console.log(
      `  - ${key} -> ${resolved.record.name} (${resolved.record.assistantId}) ` +
        `model=${resolved.model.provider}/${resolved.model.modelName}`,
    );
  }
  console.log("");

  const uploads = await uploadKnowledgeDocuments(adapter, repoRoot);
  console.log(`Uploaded ${uploads.length} knowledge document(s):`);
  for (const upload of uploads) {
    console.log(`  - [${upload.role}] ${upload.filename} -> ${upload.documentId} (${upload.status})`);
  }

  // Local-only, gitignored snapshot for quick inspection (`.backboard/`,
  // see .gitignore); never read back by the app itself, so a stale copy is
  // harmless, but a schemaVersion bump makes a stale shape easy to spot.
  const manifestFile = buildAssistantManifestFile(manifest);
  const manifestDir = path.join(repoRoot, ".backboard");
  const manifestPath = path.join(manifestDir, "assistant-manifest.local.json");
  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(manifestFile, null, 2)}\n`, "utf-8");
  console.log(
    `Wrote local manifest snapshot (schemaVersion=${manifestFile.schemaVersion}, rosterVersion=${manifestFile.rosterVersion}, product=${manifestFile.product}, assistants=${manifestFile.assistantCount}) to ${manifestPath}`,
  );
}

main().catch((error: unknown) => {
  console.error("Backboard bootstrap failed:");
  console.error(error);
  process.exitCode = 1;
});
