"use client";

import { useRef, useState } from "react";
import { CANNED_CITY_ASKS } from "@/lib/planner/canned";
import { cn } from "@/lib/utils/cn";
import { useMapStore } from "@/store/useMapStore";
import { createRunStreamClient } from "@/lib/backboard/stream-parser";

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

/** One line of the live trace: agent lifecycle, tool calls, or scoring -- not just prose tokens. */
export interface CityPlanTraceLine {
  id: string;
  text: string;
}

export interface CityPlanRunHandlers {
  /** Fired for every text token as the agent composes its reply. */
  onDelta?: (chunk: string) => void;
  /** Fired whenever a new trace line (tool call, subagent, scoring result) is ready. */
  onTrace?: (line: CityPlanTraceLine) => void;
}

function traceLineFor(event: { type: string; [key: string]: unknown }): string | null {
  switch (event.type) {
    case "agent.started":
      return `→ ${event.name as string} started`;
    case "tool.requested":
      return `⚙ calling ${event.toolName as string}…`;
    case "tool.completed":
      return `${event.ok ? "✓" : "✗"} ${event.toolName as string}`;
    case "scenarios.proposed":
      return `${(event.patches as unknown[]).length} scenario patch(es) proposed`;
    case "citizens.scored": {
      const mean = Number(event.mean).toFixed(2);
      const support = (Number(event.supportShare) * 100).toFixed(0);
      return `real acceptance scored: mean ${mean}, ${support}% support (${event.provider as string})`;
    }
    case "recommendation.ready":
      return "recommendation ready";
    case "map.actions":
      return `${(event.actions as unknown[]).length} map action(s) applied`;
    case "status":
      return event.message as string;
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
          if (envelope.type === "planner.status" && typeof payload.message === "string") {
            handlers.onTrace?.({ id: `t-${traceSeq.current++}`, text: payload.message });
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
          if (line) handlers.onTrace?.({ id: `t-${traceSeq.current++}`, text: line });
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
