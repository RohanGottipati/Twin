"use client";

import { useRef, useState } from "react";
import { CANNED_CITY_ASKS } from "@/lib/planner/canned";
import { createRunStreamClient } from "@/lib/backboard/stream-parser";
import { toolRunningLabel } from "@/lib/planner/step-messages";
import { cn } from "@/lib/utils/cn";
import { useMapStore } from "@/store/useMapStore";

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
  mapActions?: unknown[];
  threadId?: string;
}

export type CityPlanStepEvent =
  | { kind: "info"; message: string }
  | { kind: "tool_start"; toolCallId: string; toolName: string; label: string }
  | { kind: "tool_done"; toolCallId: string; toolName: string; ok: boolean };

export interface CityPlanStreamHandlers {
  onDelta?: (content: string) => void;
  onClear?: () => void;
  onStep?: (event: CityPlanStepEvent) => void;
}

export interface CityPlanStartOptions {
  threadId?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}

export function useCityPlanRun() {
  const [summary, setSummary] = useState<CityPlanRunSummary | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveText, setLiveText] = useState("");
  const abortRef = useRef<{ abort: () => void } | null>(null);
  const threadIdRef = useRef<string | undefined>(undefined);

  function start(
    question: string,
    handlers?: CityPlanStreamHandlers,
    options?: CityPlanStartOptions,
  ): Promise<CityPlanRunSummary & { mapActions?: unknown[]; threadId?: string }> {
    setIsRunning(true);
    setError(null);
    setLiveText("");
    abortRef.current?.abort();

    const agentOverlays = useMapStore.getState().agentOverlays;
    const threadId = options?.threadId ?? threadIdRef.current;
    const history = options?.history;

    return new Promise((resolve, reject) => {
      let settled = false;
      const settleOk = (value: CityPlanRunSummary & { mapActions?: unknown[]; threadId?: string }) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const settleErr = (err: Error) => {
        if (settled) return;
        settled = true;
        reject(err);
      };

      const step = (event: CityPlanStepEvent) => handlers?.onStep?.(event);

      abortRef.current = createRunStreamClient({
        url: "/api/planner/stream",
        body: { question, seed: 2262, agentOverlays, threadId, history },
        onEvent: (envelope) => {
          if (envelope.type === "planner.delta") {
            const content = (envelope.payload as { content?: unknown }).content;
            if (typeof content === "string" && content.length) {
              setLiveText((prev) => prev + content);
              handlers?.onDelta?.(content);
            }
          } else if (envelope.type === "planner.clear") {
            setLiveText("");
            handlers?.onClear?.();
          } else if (envelope.type === "planner.status") {
            const message = (envelope.payload as { message?: unknown }).message;
            if (typeof message === "string" && !/^(Starting|City Code agent is working)/i.test(message)) {
              step({ kind: "info", message });
            }
          } else if (envelope.type === "agent.started") {
            const name = (envelope.payload as { name?: unknown }).name;
            step({
              kind: "info",
              message: typeof name === "string" ? `${name} joined` : "City Code agent joined",
            });
          } else if (envelope.type === "tool.requested") {
            const payload = envelope.payload as { toolName?: unknown; toolCallId?: unknown };
            if (typeof payload.toolName === "string") {
              const toolCallId =
                typeof payload.toolCallId === "string" ? payload.toolCallId : `${payload.toolName}-${Date.now()}`;
              step({
                kind: "tool_start",
                toolCallId,
                toolName: payload.toolName,
                label: toolRunningLabel(payload.toolName),
              });
            }
          } else if (envelope.type === "tool.completed") {
            const payload = envelope.payload as { toolName?: unknown; toolCallId?: unknown; ok?: unknown };
            if (typeof payload.toolName === "string") {
              const toolCallId =
                typeof payload.toolCallId === "string" ? payload.toolCallId : `${payload.toolName}-done`;
              step({
                kind: "tool_done",
                toolCallId,
                toolName: payload.toolName,
                ok: payload.ok !== false,
              });
            }
          } else if (envelope.type === "scenarios.proposed") {
            step({ kind: "info", message: "Registered scenario candidates" });
          } else if (envelope.type === "citizens.scored") {
            step({ kind: "info", message: "Scored a candidate against the synthetic population" });
          } else if (envelope.type === "planner.failed") {
            const message =
              typeof (envelope.payload as { message?: unknown }).message === "string"
                ? ((envelope.payload as { message: string }).message)
                : "planner stream failed";
            setError(message);
            setIsRunning(false);
            settleErr(new Error(message));
          } else if (envelope.type === "planner.completed") {
            const payload = envelope.payload as {
              question?: string;
              ranking?: CityPlanRankingRow[];
              chosenId?: string;
              summary?: string;
              backboardMode?: string;
              populationMode?: string;
              participatingAgents?: string[];
              events?: string[];
              mapActions?: unknown[];
              threadId?: string;
            };
            if (typeof payload.threadId === "string" && payload.threadId) {
              threadIdRef.current = payload.threadId;
            }
            const next: CityPlanRunSummary = {
              question: payload.question ?? question,
              ranking: payload.ranking ?? [],
              chosenId: payload.chosenId ?? "",
              summary: payload.summary ?? "",
              backboardMode: payload.backboardMode ?? "live",
              populationMode: payload.populationMode ?? "unknown",
              participatingAgents: payload.participatingAgents ?? [],
              events: payload.events ?? [],
              mapActions: payload.mapActions,
              threadId: payload.threadId ?? threadIdRef.current,
            };
            setSummary(next);
            setLiveText(next.summary);
            setIsRunning(false);
            settleOk(next);
          }
        },
        onError: (err) => {
          setError(err.message);
          setIsRunning(false);
          settleErr(err);
        },
        onDone: () => {
          setIsRunning(false);
          if (!settled) settleErr(new Error("planner stream ended without a result"));
        },
      });
    });
  }

  return {
    summary,
    isRunning,
    error,
    liveText,
    threadId: threadIdRef.current,
    start,
    setSummary,
    cannedAsks: CANNED_CITY_ASKS,
  };
}

export function CityPlanStrip({
  summary,
  isRunning,
  liveText,
}: {
  summary: CityPlanRunSummary | null;
  isRunning: boolean;
  liveText?: string;
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
        {isRunning && <span className="text-muted">working…</span>}
      </div>
      {isRunning && liveText ? (
        <p className="whitespace-pre-wrap text-muted line-clamp-4">{liveText}</p>
      ) : null}
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
                {row.id === summary.chosenId ? " · leading" : ""}
              </span>
              <span className="font-mono">
                mean {row.mean.toFixed(2)} · support {(row.supportShare * 100).toFixed(0)}%
              </span>
            </li>
          ))}
        </ol>
      )}
      {!isRunning && summary && summary.ranking.length === 0 && summary.summary && (
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
