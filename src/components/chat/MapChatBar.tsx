"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import {
  ArrowUp,
  Columns2,
  Loader2,
  Maximize2,
  Minimize2,
  Plus,
  SlidersHorizontal,
} from "lucide-react";
import type { CityCopilotResponse } from "@/lib/chat/schemas";
import { parseMapActions } from "@/lib/twinto/map-actions";
import { applyMapActions } from "@/lib/twinto/apply-map-actions";
import { useMapStore } from "@/store/useMapStore";
import { useTwinTOStore } from "@/store/useTwinTOStore";
import type { UseBackboardRunResult } from "@/lib/twinto/use-backboard-run";
import { FLAGSHIP_SCENARIO_ID } from "@/data/transit/scenarios";
import { cn } from "@/lib/utils/cn";
import type { CityPlanRankingRow, CityPlanStepEvent } from "@/components/planner/CityPlanStrip";
import { ChatMarkdown } from "@/components/chat/ChatMarkdown";

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  /** true while tokens are still arriving */
  streaming?: boolean;
  /** tool step row: spinner until done */
  stepState?: "running" | "done" | "failed" | "info";
  toolCallId?: string;
}

const EXAMPLE_ASK =
  "Should I place a new train station in Wychwood or in Ionview?";

export interface MapChatBarProps {
  /** Optional TwinTO planning run. Omit on the ToronTwin dashboard. */
  run?: UseBackboardRunResult;
  includeWebSearch?: boolean;
  /** When false, chat answers only (no Backboard planning kickoff). Default true if `run` is provided. */
  enablePlanningRun?: boolean;
  /** Coolness open-city planner via /api/planner/stream (orchestrator agent). */
  enableCityPlanRun?: boolean;
  onCityPlanQuestion?: (
    question: string,
    handlers?: {
      onDelta?: (content: string) => void;
      onClear?: () => void;
      onStep?: (event: CityPlanStepEvent) => void;
    },
    options?: {
      threadId?: string;
      history?: Array<{ role: "user" | "assistant"; content: string }>;
    },
  ) => Promise<{
    summary?: string;
    ranking?: CityPlanRankingRow[];
    chosenId?: string;
    mapActions?: unknown[];
    threadId?: string;
  } | void>;
  cityPlanRunning?: boolean;
}

/**
 * Liquid-glass chat dock at the bottom of the map.
 */
export function MapChatBar({
  run,
  includeWebSearch = false,
  enablePlanningRun,
  enableCityPlanRun = false,
  onCityPlanQuestion,
  cityPlanRunning = false,
}: MapChatBarProps) {
  const planningEnabled = enablePlanningRun ?? Boolean(run);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const cityThreadIdRef = useRef<string | undefined>(undefined);

  const selectedPlace = useMapStore((s) => s.selectedPlace);
  const layers = useMapStore((s) => s.layers);
  const selectedScenarioId = useMapStore((s) => s.selectedScenarioId);
  const selectedStationId = useMapStore((s) => s.selectedStationId);

  useEffect(() => {
    fetch("/api/chat")
      .then((response) => (response.ok ? response.json() : null))
      .then(
        (
          data: {
            thread?: {
              threadId: string;
              messages: Array<{ messageId?: string; id?: string; role: ChatMessage["role"]; content: string }>;
            };
          } | null,
        ) => {
          if (!data?.thread) return;
          setThreadId(data.thread.threadId);
          const prior = (data.thread.messages ?? []).filter((message) => message.role !== "system");
          if (prior.length > 0) {
            setMessages(
              prior.map((message) => ({
                id: message.messageId ?? message.id ?? `m-${Math.random()}`,
                role: message.role,
                content: message.content,
              })),
            );
          }
        },
      )
      .catch(() => undefined);
  }, []);

  const lastRecommendation = useMemo(() => {
    if (!run) return null;
    if (run.result && "effectiveRecommendation" in run.result) {
      return (run.result as { effectiveRecommendation: { headline: string; reasoning: string } })
        .effectiveRecommendation;
    }
    for (let i = run.events.length - 1; i >= 0; i -= 1) {
      const event = run.events[i];
      if (event.type === "recommendation.ready") return event.recommendation;
    }
    return null;
  }, [run]);

  useEffect(() => {
    if (!run || !lastRecommendation || run.isRunning) return;
    setExpanded(true);
    setMessages((prev) => {
      if (prev.some((m) => m.id === `rec-${run.runId}`)) return prev;
      return [
        ...prev,
        {
          id: `rec-${run.runId ?? "done"}`,
          role: "assistant",
          content: `${lastRecommendation.headline}\n\n${lastRecommendation.reasoning}`,
        },
      ];
    });
  }, [lastRecommendation, run]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || run?.isRunning || busy) return;

    setBusy(true);
    setExpanded(true);
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", content: text }]);
    setInput("");

    const visibleLayers = Object.entries(layers)
      .filter(([, on]) => on)
      .map(([key]) => key);

    try {
      // Open-city path: Planning Orchestrator agent (tools + optional subagents)
      if (enableCityPlanRun && onCityPlanQuestion) {
        let assistantId: string | null = null;
        let streamed = "";

        const applyStep = (event: CityPlanStepEvent) => {
          flushSync(() => {
            setMessages((prev) => {
              if (event.kind === "info") {
                return [
                  ...prev,
                  {
                    id: `info-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    role: "system",
                    content: event.message,
                    stepState: "info",
                  },
                ];
              }
              if (event.kind === "tool_start") {
                return [
                  ...prev,
                  {
                    id: `tool-${event.toolCallId}`,
                    role: "system",
                    content: `${event.label}…`,
                    stepState: "running",
                    toolCallId: event.toolCallId,
                  },
                ];
              }
              // tool_done: flip the matching running row
              return prev.map((message) => {
                if (message.toolCallId !== event.toolCallId && message.id !== `tool-${event.toolCallId}`) {
                  return message;
                }
                const base = message.content.replace(/…\s*$/, "").replace(/\s*\(failed\)\s*$/i, "");
                return {
                  ...message,
                  content: event.ok ? `${base} · done` : `${base} · failed`,
                  stepState: event.ok ? "done" : "failed",
                };
              });
            });
          });
          transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight });
        };

        const paintReply = (content: string, streaming = true) => {
          flushSync(() => {
            setMessages((prev) => {
              if (!assistantId) {
                assistantId = `plan-${Date.now()}`;
                return [...prev, { id: assistantId, role: "assistant", content, streaming }];
              }
              const id = assistantId;
              return prev.map((message) =>
                message.id === id ? { ...message, content, streaming } : message,
              );
            });
          });
          transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight });
        };

        const history = messages
          .filter((message) => message.role === "user" || message.role === "assistant")
          .filter((message) => message.content.trim().length > 0)
          .slice(-12)
          .map((message) => ({
            role: message.role as "user" | "assistant",
            content: message.content,
          }));

        const payload = await onCityPlanQuestion(
          text,
          {
            onDelta: (chunk) => {
              streamed += chunk;
              paintReply(streamed, true);
            },
            onClear: () => {
              streamed = "";
              if (assistantId) paintReply("", true);
            },
            onStep: applyStep,
          },
          {
            threadId: cityThreadIdRef.current,
            history,
          },
        );
        if (payload?.threadId) cityThreadIdRef.current = payload.threadId;
        const mapParsed = parseMapActions(payload?.mapActions ?? []);
        if (mapParsed.ok) applyMapActions(mapParsed.actions);
        const ranking = payload?.ranking ?? [];
        const rankLines = ranking
          .slice(0, 5)
          .map(
            (r: CityPlanRankingRow, i: number) =>
              `${i + 1}. ${r.title} (mean ${Number(r.mean).toFixed(2)}, support ${(Number(r.supportShare) * 100).toFixed(0)}%)`,
          )
          .join("\n");
        let body = payload?.summary?.trim() || streamed.trim() || "Done.";
        if (ranking.length) {
          const leading = ranking.find((r) => r.id === payload?.chosenId)?.title ?? ranking[0]?.title;
          body +=
            `\n\nRanked options:\n${rankLines}` +
            (leading ? `\n\nLeading: ${leading}` : "") +
            "\n\n(Simulated day-one acceptance; not real public opinion or ridership.)";
        }
        paintReply(body, false);
        return;
      }

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: threadId ?? undefined,
          message: text,
          startPlanningRun: planningEnabled,
          mapContext: {
            cityId: "toronto",
            viewport: {
              longitude: selectedPlace?.coordinates[0] ?? -79.3832,
              latitude: selectedPlace?.coordinates[1] ?? 43.6532,
              zoom: 12.8,
              bounds: [-79.64, 43.58, -79.11, 43.86] as [number, number, number, number],
            },
            selectedRouteId: null,
            selectedStopId: selectedStationId,
            selectedNeighbourhoodId: selectedPlace?.neighbourhoodId ?? null,
            activeScenarioId: selectedScenarioId,
            activeSimulationId: null,
            simulationTime: null,
            visibleLayers,
            comparisonMode: "baseline" as const,
          },
        }),
      });
      if (!response.ok) {
        throw new Error(`Chat API failed (${response.status})`);
      }
      const payload = (await response.json()) as {
        thread: { threadId: string };
        response: CityCopilotResponse;
      };
      setThreadId(payload.thread.threadId);

      const copilot = payload.response;
      setMessages((prev) => [
        ...prev,
        {
          id: copilot.messageId,
          role: "assistant",
          content: copilot.answer,
        },
      ]);

      const actions = parseMapActions(copilot.mapActions);
      if (actions.ok) applyMapActions(actions.actions);

      if (planningEnabled && run && copilot.startPlanningRun) {
        useMapStore.getState().setSelectedScenario(copilot.scenarioId ?? FLAGSHIP_SCENARIO_ID);
        run.start({
          scenarioId: copilot.scenarioId ?? FLAGSHIP_SCENARIO_ID,
          includeWebSearch,
        });
      }
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: "assistant",
          content: error instanceof Error ? error.message : "Chat request failed.",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  const showTranscript = expanded && messages.length > 0;
  const isRunning = Boolean(run?.isRunning) || cityPlanRunning;

  return (
    <section className="mx-auto w-full max-w-3xl" data-testid="city-copilot-chat">
      {showTranscript && (
        <div
          className={cn(
            "mb-3 flex min-h-0 flex-col rounded-[28px] border border-white/25 px-4 py-3 text-[13px]",
            maximized ? "h-[min(68vh,680px)]" : "max-h-80",
            "bg-white/18 shadow-[0_12px_40px_-16px_rgba(15,40,80,0.45)] backdrop-blur-2xl backdrop-saturate-150",
          )}
        >
          <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
            <p className="text-[11px] font-medium text-white">ToronTwin</p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setMaximized((value) => !value)}
                className="inline-flex h-7 items-center gap-1.5 rounded-full px-2 text-[11px] text-white/55 transition hover:bg-white/10 hover:text-white"
                aria-label={maximized ? "Restore conversation size" : "Expand conversation"}
                aria-pressed={maximized}
              >
                {maximized ? (
                  <Minimize2 className="h-3 w-3" aria-hidden />
                ) : (
                  <Maximize2 className="h-3 w-3" aria-hidden />
                )}
                {maximized ? "Restore" : "Expand"}
              </button>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="h-7 rounded-full px-2 text-[11px] text-white/55 transition hover:bg-white/10 hover:text-white"
              >
                Collapse
              </button>
            </div>
          </div>
          <div ref={transcriptRef} className="min-h-0 space-y-2 overflow-y-auto pr-1 twinto-scroll">
            {messages.map((message) => (
              <div
                key={message.id}
                className={
                  message.role === "user"
                    ? "ml-8 rounded-2xl bg-white/25 px-3 py-2 text-white"
                    : message.role === "system"
                      ? "px-1 py-0.5 text-[11px] text-white/50"
                      : "mr-4 rounded-2xl bg-white/10 px-3 py-2 text-white/90"
                }
              >
                {message.role === "user" ? (
                  <p className="whitespace-pre-wrap text-[12px] leading-relaxed">{message.content}</p>
                ) : message.role === "system" ? (
                  <p className="inline-flex items-center gap-1.5 leading-snug">
                    {message.stepState === "running" ? (
                      <Loader2 className="h-3 w-3 shrink-0 animate-spin text-white/55" aria-hidden />
                    ) : message.stepState === "done" ? (
                      <span className="text-white/40" aria-hidden>
                        ✓
                      </span>
                    ) : message.stepState === "failed" ? (
                      <span className="text-red-300/80" aria-hidden>
                        ✕
                      </span>
                    ) : null}
                    <span>{message.content}</span>
                  </p>
                ) : (
                  <div>
                    {message.content ? <ChatMarkdown content={message.content} /> : null}
                    {message.streaming ? (
                      <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-white/70 align-middle" aria-hidden />
                    ) : null}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <form
        onSubmit={onSubmit}
        className={cn(
          "flex items-center gap-2 rounded-full border border-white/35 px-3 py-2",
          "bg-white/14 shadow-[0_10px_36px_-12px_rgba(40,80,140,0.55),inset_0_1px_0_rgba(255,255,255,0.35)]",
          "backdrop-blur-2xl backdrop-saturate-150",
        )}
      >
        <button
          type="button"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/70 transition hover:bg-white/15 hover:text-white"
          aria-label="Add"
        >
          <Plus className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/70 transition hover:bg-white/15 hover:text-white"
          aria-label="Chat options"
        >
          <SlidersHorizontal className="h-4 w-4" strokeWidth={1.75} />
        </button>

        <div
          className="relative min-w-0 flex-1 cursor-text"
          onClick={() => inputRef.current?.focus()}
        >
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={EXAMPLE_ASK}
            className="chat-glass-input relative w-full bg-transparent px-1 py-2 text-[15px] outline-none"
            data-testid="city-copilot-input"
            aria-label="Ask a Toronto planning question"
          />
        </div>

        {run ? (
          <button
            type="button"
            onClick={() => useTwinTOStore.getState().setPanelFocus("chat")}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/70 transition hover:bg-white/15 hover:text-white"
            aria-label="Open council panel"
          >
            <Columns2 className="h-4 w-4" strokeWidth={1.75} />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/70 transition hover:bg-white/15 hover:text-white"
            aria-label="Toggle conversation"
          >
            <Columns2 className="h-4 w-4" strokeWidth={1.75} />
          </button>
        )}

        <button
          type="submit"
          disabled={isRunning || busy || !input.trim()}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/25 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] transition hover:bg-white/40 disabled:opacity-40"
          data-testid="city-copilot-send"
          aria-label="Send"
        >
          {busy || isRunning ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ArrowUp className="h-4 w-4" strokeWidth={2.25} />
          )}
        </button>
      </form>
    </section>
  );
}
