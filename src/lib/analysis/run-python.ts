import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import type { AgentMapOverlay } from "@/lib/techto/map-overlays";
import type { TwinSnapshot } from "@/lib/planner/state";

export interface RunPythonInput {
  code: string;
  timeoutMs?: number;
  twin?: TwinSnapshot;
  overlays?: AgentMapOverlay[];
  seed?: number;
}

export interface RunPythonResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  result_preview: unknown;
  error: string | null;
  mongo_bound: boolean;
  libs: Record<string, boolean>;
}

/**
 * Spawns repo Python to run short agent analysis code with read-only Mongo.
 * Prefers `.venv/bin/python`, then `uv run python`.
 */
export function runAgentPython(input: RunPythonInput): Promise<RunPythonResult> {
  const timeoutMs = Math.min(Math.max(input.timeoutMs ?? 12_000, 1000), 30_000);
  const repoRoot = path.resolve(process.cwd());
  const venvPython = path.join(repoRoot, ".venv", "bin", "python");
  const payload = JSON.stringify({
    code: input.code,
    twin: input.twin ?? null,
    overlays: input.overlays ?? [],
    seed: input.seed ?? 2262,
  });

  const useVenv = existsSync(venvPython);
  const cmd = useVenv ? venvPython : "uv";
  const args = useVenv
    ? ["-m", "analysis.agent_exec"]
    : ["run", "python", "-m", "analysis.agent_exec"];

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: repoRoot,
      env: {
        ...process.env,
        MONGODB_URI_READONLY:
          process.env.MONGODB_URI_READONLY?.trim() || process.env.MONGODB_URI?.trim() || "",
        MONGODB_DATABASE: process.env.MONGODB_DATABASE?.trim() || "techto",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`run_python timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", () => {
      clearTimeout(timer);
      if (!stdout.trim()) {
        reject(new Error(`run_python produced no stdout. stderr=${stderr.slice(0, 2000)}`));
        return;
      }
      const parsed = JSON.parse(stdout) as RunPythonResult;
      if (stderr && !parsed.stderr) parsed.stderr = stderr.slice(-20_000);
      resolve(parsed);
    });

    child.stdin.write(payload);
    child.stdin.end();
  });
}
