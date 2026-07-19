"use client";

import { useRef, useState } from "react";
import { CANNED_CITY_ASKS } from "@/lib/planner/canned";
import { toolRunningLabel } from "@/lib/planner/step-messages";
import { cn } from "@/lib/utils/cn";
import { useMapStore } from "@/store/useMapStore";
import { createRunStreamClient } from "@/lib/backboard/stream-parser";
import type { MapAction } from "@/lib/techto/map-actions";

export interface CityPlanRankingRow {
  id: string;
  title: string;
  mean: number;
  supportShare: number;
}

export interface CityPlanRunSummary {
  question: string;
  ranking: CityPlanRankingRow[];
  chosenId: string;
  summary: string;
  backboardMode: string;
  populationMode: string;
  participatingAgents: string[];
  events: string[];
}

/** One line of the live trace: agent lifecycle, tool calls, or scoring. */
export interface CityPlanTraceLine {
  id: string;
  /** Human label without status icon (icon comes from `status`). */
  label: string;
  status: "running" | "ok" | "fail" | "info";
  /** Args preview (tool start). */
  argsDetail?: string;
  /** Output preview (tool end); keeps args so expand can show both. */
  resultDetail?: string;
}

export interface CityPlanRunHandlers {
  /** Fired for every text token as the agent composes its reply. */
  onDelta?: (chunk: string) => void;
  /** Model thinking / reasoning tokens (separate from the user-facing reply). */
  onReasoning?: (chunk: string) => void;
  /** Wipe partial prose when a mid-turn tool round starts. */
  onClear?: () => void;
  /**
   * Upsert a trace line. Same `id` (e.g. toolCallId) updates in place so
   * running → ok/fail does not duplicate the row.
   */
  onTrace?: (line: CityPlanTraceLine) => void;
  /** Mid-stream map actions: apply as soon as compose_map_actions accepts them. */
  onMapActions?: (actions: MapAction[]) => void;
  /** Fired for each real Monte-Carlo-sampled resident as score_population/run_twin_analysis scores them, so the map can colour that one dot live. */
  onPersonaScored?: (result: { personaId: string; code: string; acceptance: number; opinionText: string }) => void;
}

function rolePrefix(role: unknown): string {
  if (typeof role !== "string" || !role || role === "planning-orchestrator") return "";
  return `[${role}] `;
}

function traceLineFor(event: { type: string; [key: string]: unknown }): CityPlanTraceLine | null {
  const detail = typeof event.detail === "string" ? event.detail : undefined;
  switch (event.type) {
    case "agent.started":
      return {
        id: `agent-${event.role ?? "main"}`,
        label: `${event.name as string} started`,
        status: "info",
      };
    case "tool.requested": {
      const toolCallId = String(event.toolCallId ?? "");
      if (!toolCallId) return null;
      return {
        id: toolCallId,
        label: `${rolePrefix(event.role)}${toolRunningLabel(event.toolName as string)}`,
        status: "running",
        argsDetail: detail,
      };
    }
    case "tool.completed": {
      const toolCallId = String(event.toolCallId ?? "");
      if (!toolCallId) return null;
      return {
        id: toolCallId,
        label: `${rolePrefix(event.role)}${toolRunningLabel(event.toolName as string)}`,
        status: event.ok ? "ok" : "fail",
        resultDetail: detail,
      };
    }
    case "scenarios.proposed":
      return {
        id: "",
        label: `${(event.patches as unknown[]).length} scenario patch(es) proposed`,
        status: "info",
      };
    case "citizens.scored": {
      const mean = Number(event.mean).toFixed(2);
      const support = (Number(event.supportShare) * 100).toFixed(0);
      return {
        id: "",
        label: `real acceptance scored: mean ${mean}, ${support}% support (${event.provider as string})`,
        status: "info",
      };
    }
    case "recommendation.ready":
      return { id: "", label: "recommendation ready", status: "info" };
    case "map.actions":
    case "planner.map_actions":
      return {
        id: "",
        label: `map ← ${(event.actions as unknown[]).length} action(s)`,
        status: "info",
        resultDetail: detail ?? JSON.stringify(event.actions, null, 2),
      };
    case "status":
      return { id: "", label: event.message as string, status: "info" };
    default:
      return null;
  }
}

export function useCityPlanRun() {
  const [summary, setSummary] = useState<CityPlanRunSummary | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const traceSeq = useRef(0);

  function start(question: string, handlers: CityPlanRunHandlers = {}): Promise<Record<string, unknown>> {
    setIsRunning(true);
    setError(null);
    const agentOverlays = useMapStore.getState().agentOverlays;

    return new Promise((resolve, reject) => {
      createRunStreamClient({
        url: "/api/planner/stream",
        body: { question, seed: 2262, agentOverlays },
        onEvent: (envelope) => {
          const payload = envelope.payload as Record<string, unknown>;
          if (envelope.type === "planner.delta" && typeof payload.content === "string") {
            handlers.onDelta?.(payload.content);
            return;
          }
          if (envelope.type === "planner.reasoning" && typeof payload.content === "string") {
            handlers.onReasoning?.(payload.content);
            return;
          }
          if (envelope.type === "planner.clear") {
            handlers.onClear?.();
            return;
          }
          if (envelope.type === "planner.status" && typeof payload.message === "string") {
            handlers.onTrace?.({
              id: `t-${traceSeq.current++}`,
              label: payload.message,
              status: "info",
            });
            return;
          }
          if (envelope.type === "planner.map_actions") {
            const actions = (payload.actions as MapAction[]) ?? [];
            if (actions.length) handlers.onMapActions?.(actions);
            // no extra trace row: the compose_map_actions line already updates in place
            return;
          }
          if (envelope.type === "planner.persona_scored") {
            const { personaId, code, acceptance, opinionText } = payload as {
              personaId?: string;
              code?: string;
              acceptance?: number;
              opinionText?: string;
            };
            if (typeof personaId === "string" && typeof code === "string" && typeof acceptance === "number") {
              handlers.onPersonaScored?.({ personaId, code, acceptance, opinionText: opinionText ?? "" });
            }
            // no trace row: this is a per-resident sampling detail, not a lifecycle line
            return;
          }
          if (envelope.type === "planner.completed") {
            const next: CityPlanRunSummary = {
              question: (payload.question as string) ?? question,
              ranking: (payload.ranking as CityPlanRankingRow[]) ?? [],
              chosenId: payload.chosenId as string,
              summary: (payload.summary as string) ?? "",
              backboardMode: payload.backboardMode as string,
              populationMode: payload.populationMode as string,
              participatingAgents: (payload.participatingAgents as string[]) ?? [],
              events: ((payload.events as string[]) ?? []),
            };
            setSummary(next);
            setIsRunning(false);
            resolve(payload);
            return;
          }
          if (envelope.type === "planner.failed") {
            setIsRunning(false);
            setError((payload.message as string) ?? "planner run failed");
            reject(new Error((payload.message as string) ?? "planner run failed"));
            return;
          }
          const line = traceLineFor({ type: envelope.type, ...payload });
          if (line) {
            handlers.onTrace?.({
              ...line,
              id: line.id || `t-${traceSeq.current++}`,
            });
          }
        },
        onError: (err) => {
          setIsRunning(false);
          setError(err.message);
          reject(err);
        },
      });
    });
  }

  return { summary, isRunning, error, start, setSummary, cannedAsks: CANNED_CITY_ASKS };
}

export function CityPlanStrip({
  summary,
  isRunning,
}: {
  summary: CityPlanRunSummary | null;
  isRunning: boolean;
}) {
  if (!summary && !isRunning) return null;
  return (
    <div
      className="pointer-events-auto w-full max-w-3xl border border-hairline bg-panel/95 px-3 py-2 text-[11px] text-ink-dim backdrop-blur"
      data-testid="city-plan-strip"
    >
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="font-ui text-[10px] font-semibold uppercase tracking-[0.2em] text-ink-bright">
          City plan
        </span>
        {summary && (
          <>
            <Badge label={`Backboard ${summary.backboardMode}`} />
            <Badge label={`citizens ${summary.populationMode}`} />
            <Badge label={`${summary.participatingAgents.length} agents`} />
          </>
        )}
        {isRunning && <span className="text-muted">running principled roster…</span>}
      </div>
      {summary && summary.ranking.length > 0 && (
        <ol className="space-y-1">
          {summary.ranking.map((row, i) => (
            <li
              key={row.id}
              className={cn(
                "flex justify-between gap-2",
                row.id === summary.chosenId ? "text-ink-bright" : "text-muted",
              )}
            >
              <span>
                {i + 1}. {row.title}
                {row.id === summary.chosenId ? " · chosen" : ""}
              </span>
              <span className="font-mono">
                mean {row.mean.toFixed(2)} · support {(row.supportShare * 100).toFixed(0)}%
              </span>
            </li>
          ))}
        </ol>
      )}
      {summary && summary.ranking.length === 0 && summary.summary && (
        <p className="text-muted line-clamp-3">{summary.summary}</p>
      )}
    </div>
  );
}

function Badge({ label }: { label: string }) {
  return (
    <span className="border border-hairline px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted">
      {label}
    </span>
  );
}
