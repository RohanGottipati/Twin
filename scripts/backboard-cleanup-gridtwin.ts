/**
 * Lists every Backboard assistant whose name starts with "GridTwin" (the
 * old battery-control product this repo has migrated away from; see
 * AGENTS.md and docs/twinto-implementation.md section 5.2) and, only when
 * `--confirm` is passed, deletes them.
 *
 * Without `--confirm` this is a dry run: it only lists what it would
 * delete, so it is safe to run at any time to check for leftover GridTwin
 * assistants on a shared Backboard account.
 *
 * Usage:
 *   tsx scripts/backboard-cleanup-gridtwin.ts            # dry run, lists only
 *   tsx scripts/backboard-cleanup-gridtwin.ts --confirm   # actually deletes
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

const GRIDTWIN_NAME_PREFIX = "GridTwin";

async function main(): Promise<void> {
  const confirm = process.argv.includes("--confirm");

  const { isBackboardMockMode, getBackboardBaseUrl } = await import("@/lib/backboard/env");
  const { getBackboardAdapter } = await import("@/lib/backboard/adapter");

  const mock = isBackboardMockMode();
  console.log(`Backboard mode: ${mock ? "MOCK (offline)" : "LIVE"}`);
  console.log(`Base URL: ${getBackboardBaseUrl()}`);
  console.log(`Mode: ${confirm ? "DELETE (--confirm passed)" : "DRY RUN (pass --confirm to actually delete)"}`);
  console.log("");

  const adapter = getBackboardAdapter();
  const assistants = await adapter.listAssistants();
  const gridtwinAssistants = assistants.filter((assistant) => assistant.name.startsWith(GRIDTWIN_NAME_PREFIX));

  if (gridtwinAssistants.length === 0) {
    console.log(`No assistants found with a name starting with "${GRIDTWIN_NAME_PREFIX}".`);
    return;
  }

  console.log(`Found ${gridtwinAssistants.length} GridTwin assistant(s):`);
  for (const assistant of gridtwinAssistants) {
    console.log(`  - ${assistant.name} (${assistant.assistantId})`);
  }
  console.log("");

  if (!confirm) {
    console.log("Dry run only: no assistants were deleted. Re-run with --confirm to delete the assistants listed above.");
    return;
  }

  console.log("Deleting...");
  let deleted = 0;
  for (const assistant of gridtwinAssistants) {
    try {
      await adapter.deleteAssistant(assistant.assistantId);
      console.log(`  deleted ${assistant.name} (${assistant.assistantId})`);
      deleted += 1;
    } catch (error) {
      console.error(`  failed to delete ${assistant.name} (${assistant.assistantId}): ${error instanceof Error ? error.message : error}`);
    }
  }
  console.log("");
  console.log(`Deleted ${deleted} of ${gridtwinAssistants.length} GridTwin assistant(s).`);
}

main().catch((error: unknown) => {
  console.error("Backboard GridTwin cleanup failed:");
  console.error(error);
  process.exitCode = 1;
});
