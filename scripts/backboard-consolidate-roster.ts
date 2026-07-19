/**
 * Dry-run (default) or confirmed cleanup of obsolete Backboard assistants
 * after the TechTO roster consolidated from 54 specialists to 16.
 *
 * Usage:
 *   npm run backboard:consolidate-roster
 *   npm run backboard:consolidate-roster -- --confirm
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

type Classification = "KEEP" | "CREATE" | "UPDATE" | "REMOVE_OLD_TECHTO" | "REMOVE_GRIDTWIN" | "UNKNOWN";

async function main(): Promise<void> {
  const confirm = process.argv.includes("--confirm");
  const { getBackboardBaseUrl } = await import("@/lib/backboard/env");
  const { getBackboardAdapter } = await import("@/lib/backboard/adapter");
  const { ASSISTANT_ROSTER, TECHTO_ASSISTANT_KEYS } = await import("@/lib/backboard/assistants");
  const { getAssistantManifest } = await import("@/lib/backboard/assistant-manifest");
  const { MANIFEST_ROSTER_VERSION, buildAssistantManifestFile } = await import(
    "@/lib/backboard/manifest-schema"
  );

  console.log(`Backboard mode: LIVE`);
  console.log(`Base URL: ${getBackboardBaseUrl()}`);
  console.log(`Mode: ${confirm ? "CONFIRM DELETE" : "DRY RUN"}`);
  console.log(`Target roster: ${MANIFEST_ROSTER_VERSION} (${TECHTO_ASSISTANT_KEYS.length} assistants)`);
  console.log("");

  const adapter = getBackboardAdapter();
  const existing = await adapter.listAssistants();
  const keepNames = new Set(Object.values(ASSISTANT_ROSTER).map((role) => role.name));
  const rows: Array<{ name: string; id: string; classification: Classification }> = [];

  for (const assistant of existing) {
    let classification: Classification = "UNKNOWN";
    if (keepNames.has(assistant.name)) classification = "UPDATE";
    else if (assistant.name.startsWith("GridTwin")) classification = "REMOVE_GRIDTWIN";
    else if (assistant.name.startsWith("TechTO —") || assistant.name.startsWith("TechTO -")) {
      classification = "REMOVE_OLD_TECHTO";
    }
    rows.push({ name: assistant.name, id: assistant.assistantId, classification });
  }

  for (const key of TECHTO_ASSISTANT_KEYS) {
    const name = ASSISTANT_ROSTER[key].name;
    if (!existing.some((assistant) => assistant.name === name)) {
      rows.push({ name, id: "(missing)", classification: "CREATE" });
    }
  }

  const byClass = (c: Classification) => rows.filter((row) => row.classification === c);
  for (const classification of [
    "KEEP",
    "CREATE",
    "UPDATE",
    "REMOVE_OLD_TECHTO",
    "REMOVE_GRIDTWIN",
    "UNKNOWN",
  ] as Classification[]) {
    const group = byClass(classification);
    if (group.length === 0) continue;
    console.log(`${classification} (${group.length}):`);
    for (const row of group) console.log(`  - ${row.name} (${row.id})`);
    console.log("");
  }

  const reportDir = path.join(repoRoot, "docs/backboard/roster-reconciliation");
  mkdirSync(reportDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = path.join(reportDir, `${confirm ? "confirm" : "dry-run"}-${stamp}.md`);
  const reportBody = [
    `# Roster reconciliation (${confirm ? "confirm" : "dry-run"})`,
    "",
    `- When: ${new Date().toISOString()}`,
    `- Mode: live`,
    `- Roster: ${MANIFEST_ROSTER_VERSION}`,
    "",
    ...rows.map((row) => `- **${row.classification}**: ${row.name} (\`${row.id}\`)`),
    "",
    "Assistant IDs in this report are local scratch only; do not commit secrets.",
    "",
  ].join("\n");
  writeFileSync(reportPath, reportBody, "utf-8");
  console.log(`Wrote report: ${path.relative(repoRoot, reportPath)}`);

  if (!confirm) {
    console.log("Dry run only. Re-run with --confirm after bootstrap + smoke succeed.");
    return;
  }

  const manifest = await getAssistantManifest(adapter);
  const built = buildAssistantManifestFile(manifest);
  if (built.assistantCount !== 16) {
    throw new Error(`Active manifest has ${built.assistantCount} assistants; expected 16.`);
  }

  const missing = byClass("CREATE");
  if (missing.length > 0) {
    throw new Error(`Cannot confirm cleanup while ${missing.length} new assistant(s) are missing. Run bootstrap first.`);
  }

  const toDelete = [...byClass("REMOVE_OLD_TECHTO"), ...byClass("REMOVE_GRIDTWIN")];
  console.log(`Deleting ${toDelete.length} obsolete assistant(s)...`);
  for (const row of toDelete) {
    if (row.id === "(missing)") continue;
    await adapter.deleteAssistant(row.id);
    console.log(`  deleted ${row.name}`);
  }
  console.log("Done.");
}

main().catch((error: unknown) => {
  console.error("Roster consolidation failed:");
  console.error(error);
  process.exitCode = 1;
});
