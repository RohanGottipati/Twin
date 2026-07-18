"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Loader2, SendHorizontal, Sparkles } from "lucide-react";
import type { CityCopilotResponse } from "@/lib/chat/schemas";
import { parseMapActions, type MapAction } from "@/lib/twinto/map-actions";
import { useMapStore } from "@/store/useMapStore";
import { useTwinTOStore } from "@/store/useTwinTOStore";
import type { UseBackboardRunResult } from "@/lib/twinto/use-backboard-run";
import { FLAGSHIP_SCENARIO_ID } from "@/data/transit/scenarios";
import { TORONTO_SCOPE_SHORT } from "@/lib/twinto/toronto-scope";

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
}

function applyMapActions(actions: MapAction[]): void {
  const map = useMapStore.getState();
  for (const action of actions) {
    if (action.type === "fly_to_center") {
      map.setCameraTarget({ center: action.center, zoom: action.zoom });
    } else if (action.type === "highlight_neighbourhoods") {
      map.setHighlightedNeighbourhoods(action.neighbourhoodIds);
    } else if (action.type === "show_candidate_markers") {
      map.setCandidateMarkers(action.candidates);
    } else if (action.type === "select_candidate") {
      useTwinTOStore.getState().setSelectedCandidate(action.candidateId);
    } else if (action.type === "open_panel") {
      const focus =
        action.panel === "citizen_reactions"
          ? "citizens"
          : action.panel === "candidate_details" || action.panel === "policy_comparison"
            ? "recommendation"
            : "chat";
      useTwinTOStore.getState().setPanelFocus(focus);
    }
  }
}

export interface CityCopilotChatProps {
  /** Shared Backboard run from the app shell so council + dock stay in sync. */
  run: UseBackboardRunResult;
  includeWebSearch?: boolean;
}

/**
 * Persistent City Copilot dock. Posts to `/api/chat` for intent + map actions,
 * and starts the shared Backboard planning run when the server requests it.
 */
export function CityCopilotChat({ run, includeWebSearch = false }: CityCopilotChatProps) {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "system",
      content: `City Copilot is ready. ${TORONTO_SCOPE_SHORT} Ask about Toronto neighbourhood station placement, the 4:06/4:12 Union schedule scenario, or concert service changes. Simulated planning only.`,
    },
  ]);

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
          if (data.thread.messages?.length) {
            setMessages(
              data.thread.messages.map((message) => ({
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
    if (run.result && "effectiveRecommendation" in run.result) {
      return (run.result as { effectiveRecommendation: { headline: string; reasoning: string } })
        .effectiveRecommendation;
    }
    for (let i = run.events.length - 1; i >= 0; i -= 1) {
      const event = run.events[i];
      if (event.type === "recommendation.ready") return event.recommendation;
    }
    return null;
  }, [run.events, run.result]);

  useEffect(() => {
    if (!lastRecommendation || run.isRunning) return;
    setMessages((prev) => {
      if (prev.some((m) => m.id === `rec-${run.runId}`)) return prev;
      return [
        ...prev,
        {
          id: `rec-${run.runId ?? "done"}`,
          role: "assistant",
          content: `${lastRecommendation.headline}\n\n${lastRecommendation.reasoning}\n\nAssumptions: Toronto synthetic fixtures; simulated citizen reactions; deterministic simulator is numerical authority.`,
        },
      ];
    });
  }, [lastRecommendation, run.isRunning, run.runId]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || run.isRunning || busy) return;

    setBusy(true);
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", content: text }]);
    setInput("");

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: threadId ?? undefined,
          message: text,
          startPlanningRun: true,
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

      if (copilot.startPlanningRun) {
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

  return (
    <section
      className="mx-auto w-full max-w-3xl rounded-2xl border border-white/10 bg-[#0b1220]/95 shadow-2xl backdrop-blur"
      data-testid="city-copilot-chat"
    >
      <div className="flex flex-col gap-1 border-b border-white/10 px-4 py-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-twinto-accent" />
          <span className="text-xs font-semibold text-twinto-text">City Copilot</span>
          <span className="text-[11px] text-twinto-muted">
            persistent thread · {threadId ? threadId.slice(0, 18) : "connecting…"}
          </span>
        </div>
        <p className="text-[11px] font-medium text-twinto-amber" data-testid="toronto-scope-banner">
          Scope: City of Toronto only. Agents will not propose locations outside Toronto.
        </p>
      </div>
      <div className="max-h-40 space-y-2 overflow-y-auto px-4 py-3 text-xs twinto-scroll">
        {messages.map((message) => (
          <div
            key={message.id}
            className={
              message.role === "user"
                ? "ml-8 rounded-lg bg-twinto-accent/20 px-3 py-2 text-twinto-text"
                : "mr-4 rounded-lg bg-white/[0.03] px-3 py-2 text-twinto-muted whitespace-pre-wrap"
            }
          >
            {message.content}
          </div>
        ))}
        {(run.isRunning || busy) && (
          <div className="inline-flex items-center gap-2 text-twinto-amber">
            <Loader2 className="h-3 w-3 animate-spin" />{" "}
            {busy ? "City Copilot is thinking…" : "Planning specialists are working…"}
          </div>
        )}
      </div>
      <form onSubmit={onSubmit} className="flex items-center gap-2 border-t border-white/10 px-3 py-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask TwinTO… e.g. best neighbourhood for a new subway station"
          className="flex-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-twinto-text outline-none placeholder:text-twinto-muted focus:border-twinto-accent/50"
          data-testid="city-copilot-input"
        />
        <button
          type="submit"
          disabled={run.isRunning || busy || !input.trim()}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-twinto-accent text-white disabled:opacity-40"
          data-testid="city-copilot-send"
          aria-label="Send"
        >
          <SendHorizontal className="h-4 w-4" />
        </button>
      </form>
    </section>
  );
}
