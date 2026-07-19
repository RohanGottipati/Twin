"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUp, Loader2, MapPin, Maximize2, Minimize2, X } from "lucide-react";
import { createRunStreamClient } from "@/lib/backboard/stream-parser";
import { parseMapActions } from "@/lib/techto/map-actions";
import { applyMapActions } from "@/lib/techto/apply-map-actions";
import { FLAGSHIP_SCENARIO_ID } from "@/data/transit/scenarios";
import { useMapStore } from "@/store/useMapStore";
import { cn } from "@/lib/utils/cn";
import { ChatMarkdown } from "@/components/chat/ChatMarkdown";
import { PdfExportButton } from "@/components/chat/PdfExportButton";

interface MiniMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  assistantKey?: string;
  citedEvidence?: string[];
}

function placeKindLabel(kind: "building" | "station" | "neighbourhood"): string {
  if (kind === "neighbourhood") return "Neighbourhood";
  if (kind === "station") return "Station";
  return "Building";
}

function welcomeForPlace(kind: "building" | "station" | "neighbourhood", label: string): string {
  if (kind === "neighbourhood") {
    return `You're looking at ${label}. Ask about day-one acceptance here, who might oppose a change, or how this area compares citywide.`;
  }
  if (kind === "station") {
    return `Selected ${label}. Ask how nearby residents might react to a transit or service change.`;
  }
  return `Selected a building near ${label}. Ask how people living or working around here might react on day one.`;
}

/**
 * Compact liquid-glass chat for a selected map place (neighbourhood, building, or station).
 */
export function BuildingMiniChat({
  placement = "floating",
}: {
  placement?: "floating" | "below-inspector";
}) {
  const place = useMapStore((s) => s.selectedPlace);
  const open = useMapStore((s) => s.buildingMiniChatOpen);
  const clearPlaceSelection = useMapStore((s) => s.clearPlaceSelection);
  const selectedScenarioId = useMapStore((s) => s.selectedScenarioId);
  const layers = useMapStore((s) => s.layers);

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState<MiniMessage[]>([]);
  const [activeAgent, setActiveAgent] = useState<string | null>(null);
  const threadIdRef = useRef<string | undefined>(undefined);
  const placeIdRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!place) return;
    if (placeIdRef.current === place.id) return;
    placeIdRef.current = place.id;
    threadIdRef.current = undefined;
    setActiveAgent(null);
    setMessages([
      {
        id: `welcome-${place.id}`,
        role: "assistant",
        content: welcomeForPlace(place.kind, place.label),
      },
    ]);
    setInput("");
    setExpanded(false);
  }, [place]);

  if (!open || !place) return null;

  function updateLast(content: string | ((prev: string) => string)) {
    setMessages((prev) =>
      prev.map((entry, index) => {
        if (index !== prev.length - 1) return entry;
        const next = typeof content === "function" ? content(entry.content) : content;
        return { ...entry, content: next };
      }),
    );
  }

  function answerReportMessages(answerIndex: number): MiniMessage[] {
    const answer = messages[answerIndex];
    const question = messages
      .slice(0, answerIndex)
      .reverse()
      .find((message) => message.role === "user");
    return question ? [question, answer] : [answer];
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy || !place) return;

    setBusy(true);
    setInput("");
    setMessages((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: "user", content: text },
      { id: `a-${Date.now()}`, role: "assistant", content: "" },
    ]);

    const visibleLayers = Object.entries(layers)
      .filter(([, on]) => on)
      .map(([key]) => key);

    createRunStreamClient({
      url: "/api/backboard/place-chat",
      body: {
        scenarioId: selectedScenarioId ?? FLAGSHIP_SCENARIO_ID,
        threadId: threadIdRef.current,
        question: text,
        place,
        mapContext: {
          center: place.coordinates,
          zoom: 15,
          selectedStationId: place.stationId,
          selectedNeighbourhoodId: place.neighbourhoodId,
          highlightedNeighbourhoodIds: place.neighbourhoodId ? [place.neighbourhoodId] : [],
          visibleLayers,
        },
      },
      onEvent: (envelope) => {
        if (envelope.type === "place.completed") {
          const payload = envelope.payload as {
            answer?: { answer?: string; citedEvidence?: string[] };
            threadId?: string;
            assistantKey?: string;
            mapActions?: unknown[];
          };
          if (payload.threadId) threadIdRef.current = payload.threadId;
          if (payload.assistantKey) setActiveAgent(payload.assistantKey);
          setMessages((prev) =>
            prev.map((entry, index) =>
              index === prev.length - 1
                ? {
                    ...entry,
                    content: payload.answer?.answer ?? "No answer returned.",
                    assistantKey: payload.assistantKey,
                    citedEvidence: payload.answer?.citedEvidence ?? [],
                  }
                : entry,
            ),
          );
          const actions = parseMapActions(payload.mapActions ?? []);
          if (actions.ok) applyMapActions(actions.actions);
        } else if (envelope.type === "place.failed") {
          const payload = envelope.payload as { message?: string };
          updateLast(payload.message ?? "Could not answer that. Try again.");
        }
      },
      onError: (error) => {
        updateLast(error.message);
        setBusy(false);
      },
      onDone: () => setBusy(false),
    });
  }

  return (
    <aside
      className={cn(
        "pointer-events-auto z-30 flex flex-col overflow-hidden",
        placement === "floating"
          ? "absolute bottom-28 right-4 w-[min(92vw,340px)] md:bottom-32"
          : "relative w-[288px] max-w-[calc(100vw-2rem)]",
        "rounded-[26px] border border-white/30",
        "bg-black/35 shadow-[0_18px_50px_-18px_rgba(0,0,0,0.65),inset_0_1px_0_rgba(255,255,255,0.35)]",
        "backdrop-blur-2xl backdrop-saturate-150",
      )}
      data-testid="building-mini-chat"
    >
      <header className="flex items-start gap-2 border-b border-white/15 px-3 py-2.5">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/15 text-white">
          <MapPin className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white">{place.label}</p>
          <p className="truncate text-[11px] text-white/55">
            {placeKindLabel(place.kind)}
            {activeAgent ? ` · ${activeAgent}` : " · ask about local reaction"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <PdfExportButton
            report={{
              title: `${place.label} planning conversation`,
              subtitle: `${placeKindLabel(place.kind)} context in Toronto`,
              messages,
            }}
            compact
            testId="place-chat-export-pdf"
          />
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-white/60 transition hover:bg-white/15 hover:text-white"
            aria-label={expanded ? "Restore place chat size" : "Expand place chat"}
            aria-pressed={expanded}
          >
            {expanded ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={() => clearPlaceSelection()}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-white/60 transition hover:bg-white/15 hover:text-white"
            aria-label="Close place chat"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      <div
        className={cn(
          "space-y-2 overflow-y-auto px-3 py-2.5 text-xs techto-scroll",
          expanded ? "max-h-[45vh]" : "max-h-64",
        )}
      >
        {messages.map((message, index) => (
          <div
            key={message.id}
            className={
              message.role === "user"
                ? "ml-6 rounded-2xl bg-white/20 px-2.5 py-1.5 text-white"
                : "mr-4 rounded-2xl bg-white/10 px-2.5 py-1.5 text-white/90"
            }
          >
            {message.role === "user" ? (
              <p className="whitespace-pre-wrap">{message.content}</p>
            ) : (
              <>
                <ChatMarkdown content={message.content || (busy ? "…" : "")} />
                {message.content && (
                  <div className="mt-1 flex justify-end border-t border-white/10 pt-1">
                    <PdfExportButton
                      report={{
                        title: `${place.label} planning answer`,
                        subtitle: `${placeKindLabel(place.kind)} context in Toronto`,
                        messages: answerReportMessages(index),
                      }}
                      compact
                      testId={`place-answer-export-pdf-${index}`}
                    />
                  </div>
                )}
              </>
            )}
            {message.citedEvidence && message.citedEvidence.length > 0 && (
              <p className="mt-1 text-[10px] text-white/45">
                Sources: {message.citedEvidence.slice(0, 3).join(" · ")}
              </p>
            )}
          </div>
        ))}
        {busy && (
          <div className="inline-flex items-center gap-1.5 text-white/70">
            <Loader2 className="h-3 w-3 animate-spin" />
            Thinking…
          </div>
        )}
      </div>

      <form
        onSubmit={onSubmit}
        className="flex items-center gap-1.5 border-t border-white/15 px-2 py-2"
      >
        <div
          className="relative min-w-0 flex-1 cursor-text"
          onClick={() => inputRef.current?.focus()}
        >
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about this area…"
            className="chat-glass-input relative w-full rounded-full bg-white/10 px-3 py-2 text-sm outline-none"
            data-testid="building-mini-chat-input"
            aria-label="Ask about this area"
          />
        </div>
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20 text-white disabled:opacity-40"
          data-testid="building-mini-chat-send"
          aria-label="Send"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3.5 w-3.5" />}
        </button>
      </form>
    </aside>
  );
}
