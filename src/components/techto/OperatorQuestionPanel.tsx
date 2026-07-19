"use client";

import { useRef, useState } from "react";
import { Loader2, MessageSquare, Send } from "lucide-react";
import { GlassPanel } from "@/components/primitives/GlassPanel";
import { EmptyState } from "@/components/feedback/EmptyState";
import { createRunStreamClient } from "@/lib/backboard/stream-parser";
import { cn } from "@/lib/utils/cn";
import type { TechTORunResult } from "@/lib/techto/types";

export interface OperatorQuestionPanelProps {
  scenarioId: string;
  result: TechTORunResult | null;
}

interface QaEntry {
  question: string;
  answer: string | null;
  citedEvidence: string[];
  error: string | null;
  streaming: boolean;
}

const EXAMPLE_PROMPTS = [
  "Why was the recommended candidate chosen over the others?",
  "What happens if the concert crowd surge arrives 10 minutes early?",
  "Would this recommendation change if the vehicle capacity were 10% lower?",
  "Which cohort is least happy with this candidate, and why?",
];

function runContextFor(result: TechTORunResult): string {
  return [
    `Effective recommendation: ${result.effectiveRecommendation.headline}`,
    result.effectiveRecommendation.reasoning,
    result.recommendationOverridden
      ? `Note: this recommendation was overridden by deterministic checks (${result.overrideReason ?? "unspecified"}).`
      : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

/** Free-text follow-up answered by the TTC Operator Explanation Agent via /api/backboard/operator-question. */
export function OperatorQuestionPanel({ scenarioId, result }: OperatorQuestionPanelProps) {
  const [question, setQuestion] = useState("");
  const [entries, setEntries] = useState<QaEntry[]>([]);
  const [isAsking, setIsAsking] = useState(false);
  const threadIdRef = useRef<string | undefined>(undefined);

  const canAsk = question.trim().length > 0 && !isAsking;

  function updateLastEntry(update: Partial<QaEntry>) {
    setEntries((prev) => prev.map((entry, index) => (index === prev.length - 1 ? { ...entry, ...update } : entry)));
  }

  function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isAsking) return;

    setIsAsking(true);
    setEntries((prev) => [...prev, { question: trimmed, answer: null, citedEvidence: [], error: null, streaming: true }]);
    setQuestion("");

    createRunStreamClient({
      url: "/api/backboard/operator-question",
      body: {
        scenarioId,
        threadId: threadIdRef.current,
        runContext: result ? runContextFor(result) : undefined,
        question: trimmed,
      },
      onEvent: (envelope) => {
        if (envelope.type === "operator.delta") {
          const content = (envelope.payload as { content?: unknown }).content;
          if (typeof content === "string") {
            setEntries((prev) =>
              prev.map((entry, index) => (index === prev.length - 1 ? { ...entry, answer: (entry.answer ?? "") + content } : entry)),
            );
          }
        } else if (envelope.type === "operator.completed") {
          const payload = envelope.payload as {
            answer?: { answer?: string; citedEvidence?: string[] };
            threadId?: string;
          };
          if (payload.threadId) threadIdRef.current = payload.threadId;
          updateLastEntry({
            answer: payload.answer?.answer ?? null,
            citedEvidence: payload.answer?.citedEvidence ?? [],
            streaming: false,
          });
        } else if (envelope.type === "operator.failed") {
          const payload = envelope.payload as { message?: string };
          updateLastEntry({ error: payload.message ?? "The operator question failed.", streaming: false });
        }
      },
      onError: (error) => {
        updateLastEntry({ error: error.message, streaming: false });
        setIsAsking(false);
      },
      onDone: () => setIsAsking(false),
    });
  }

  return (
    <GlassPanel className="flex h-full flex-col p-4" data-testid="operator-question-panel">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-twinto-accent" />
        <h3 className="text-sm font-semibold text-twinto-text">Ask the TTC Operator Explanation Agent</h3>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {EXAMPLE_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => ask(prompt)}
            disabled={isAsking}
            data-testid="operator-example-prompt"
            className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-techto-muted transition-colors hover:bg-white/[0.07] hover:text-techto-text disabled:cursor-not-allowed disabled:opacity-50"
          >
            {prompt}
          </button>
        ))}
      </div>

      <div className="mt-3 flex-1 space-y-2.5 overflow-y-auto pr-1 techto-scroll">
        {entries.length === 0 && (
          <EmptyState
            title="No questions yet"
            description="Ask a question grounded in this run's evidence, or pick an example above. Works even without a completed run."
          />
        )}
        {entries.map((entry, index) => (
          <div key={index} className="rounded-lg border border-white/5 bg-white/[0.02] p-2.5" data-testid="operator-answer">
            <p className="text-xs font-medium text-twinto-text">{entry.question}</p>
            {entry.answer && <p className="mt-1 text-xs leading-relaxed text-twinto-muted">{entry.answer}</p>}
            {entry.citedEvidence.length > 0 && (
              <ul className="mt-1 space-y-0.5">
                {entry.citedEvidence.map((cite, citeIndex) => (
                  <li key={citeIndex} className="text-[10px] text-techto-accent/80">
                    &middot; {cite}
                  </li>
                ))}
              </ul>
            )}
            {entry.error && <p className="mt-1 text-[11px] text-techto-amber">{entry.error}</p>}
            {entry.streaming && !entry.answer && !entry.error && (
              <p className="mt-1 inline-flex items-center gap-1.5 text-[11px] text-techto-muted">
                <Loader2 className="h-3 w-3 animate-spin" />
                Thinking...
              </p>
            )}
          </div>
        ))}
      </div>

      <form
        className="mt-3 flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          ask(question);
        }}
      >
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask about this run..."
          className="flex-1 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-techto-text placeholder:text-techto-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-techto-accent"
        />
        <button
          type="submit"
          disabled={!canAsk}
          className={cn(
            "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors",
            canAsk
              ? "border-techto-accent/50 bg-techto-accent/10 text-techto-accent hover:bg-techto-accent/20"
              : "border-white/10 bg-white/[0.03] text-techto-muted",
          )}
          aria-label="Ask"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </GlassPanel>
  );
}
