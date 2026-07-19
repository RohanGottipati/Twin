"use client";

import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Radio } from "lucide-react";
import { GlassPanel } from "@/components/primitives/GlassPanel";
import { EmptyState } from "@/components/feedback/EmptyState";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import type { TechTORunEvent } from "@/lib/techto/types";

function describeEvent(event: TechTORunEvent): { title: string; detail?: string; tone: "info" | "success" | "error" } {
  switch (event.type) {
    case "run.started":
      return { title: `Run started`, detail: event.scenarioId, tone: "info" };
    case "problem.started":
      return { title: "Framing the problem", tone: "info" };
    case "problem.completed":
      return { title: "Problem framed", detail: event.summary, tone: "success" };
    case "baseline.started":
      return { title: "Establishing baseline", tone: "info" };
    case "baseline.completed":
      return { title: "Baseline established", detail: event.summary, tone: "success" };
    case "context.started":
      return { title: "Gathering context", tone: "info" };
    case "context.completed":
      return { title: "Context gathered", detail: event.summary, tone: "success" };
    case "policy.generated":
      return { title: "Candidate proposed", detail: event.intervention.label, tone: "success" };
    case "citizens.started":
      return { title: "Running citizen reaction model", tone: "info" };
    case "citizens.completed":
      return {
        title: `Citizen reactions computed (${event.candidateId})`,
        detail: `${(event.result.aggregate.populationWeightedAcceptance * 100).toFixed(0)}% weighted acceptance`,
        tone: "success",
      };
    case "simulation.started":
      return { title: "Running deterministic simulation", tone: "info" };
    case "simulation.completed":
      return { title: `Simulation complete (${event.candidateId})`, detail: event.summary, tone: "success" };
    case "impact.started":
      return { title: "Reviewing impact", tone: "info" };
    case "impact.completed":
      return { title: "Impact review complete", detail: event.summary, tone: "success" };
    case "stress.started":
      return { title: "Stress-testing candidates", tone: "info" };
    case "stress.completed":
      return {
        title: `Stress test (${event.candidateId})`,
        detail: event.summary,
        tone: event.invalidated ? "error" : "success",
      };
    case "debate.started":
      return { title: "Policy debate underway", tone: "info" };
    case "debate.completed":
      return { title: "Debate concluded", detail: event.summary, tone: "success" };
    case "recommendation.ready":
      return { title: "Final recommendation ready", detail: event.recommendation.headline, tone: "success" };
    case "operator.ready":
      return { title: "Ready for operator questions", tone: "info" };
    case "run.completed":
      return { title: "Run completed", tone: "success" };
    case "run.failed":
      return { title: "Run failed", detail: event.error, tone: "error" };
    case "agent.started":
      return { title: `${event.name} started`, tone: "info" };
    case "agent.completed":
      return { title: `${event.name} completed`, detail: event.summary, tone: "success" };
    case "agent.failed":
      return { title: `${event.name} failed`, detail: event.error, tone: "error" };
    case "tool.requested":
      return { title: `${event.role} called ${event.toolName}`, tone: "info" };
    case "tool.completed":
      return { title: `${event.toolName} ${event.ok ? "succeeded" : "failed"}`, tone: event.ok ? "success" : "error" };
    default:
      return { title: (event as { type: string }).type, tone: "info" };
  }
}

const TONE_COLOR: Record<"info" | "success" | "error", string> = {
  info: "border-white/5 bg-white/[0.02]",
  success: "border-techto-teal/20 bg-techto-teal/[0.05]",
  error: "border-techto-error/30 bg-techto-error/[0.06]",
};

export interface AgentTimelineProps {
  events: TechTORunEvent[];
  isRunning: boolean;
}

/** Chronological lifecycle stream for one run: problem framing through final recommendation, mirrored by generic agent/tool events. */
export function AgentTimeline({ events, isRunning }: AgentTimelineProps) {
  const scrollRef = useRef<HTMLUListElement>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [events.length]);

  return (
    <GlassPanel className="flex h-full flex-col p-4" data-testid="agent-timeline">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Radio className="h-4 w-4 text-techto-accent" />
          <h3 className="text-sm font-semibold text-techto-text">Agent Timeline</h3>
        </div>
        {isRunning && (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-techto-teal">
            <Loader2 className="h-3 w-3 animate-spin" />
            live
          </span>
        )}
      </div>

      {events.length === 0 ? (
        <div className="mt-3 flex-1">
          <EmptyState title="No run yet" description="Start a run to watch the planning department work through this scenario." />
        </div>
      ) : (
        <ul ref={scrollRef} className="mt-3 flex-1 space-y-1.5 overflow-y-auto pr-1 techto-scroll">
          <AnimatePresence initial={false}>
            {events.map((event, index) => {
              const { title, detail, tone } = describeEvent(event);
              return (
                <motion.li
                  key={index}
                  initial={reducedMotion ? false : { opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.18 }}
                  className={`rounded-lg border px-2.5 py-1.5 ${TONE_COLOR[tone]}`}
                >
                  <p className="text-xs font-medium text-techto-text">{title}</p>
                  {detail && <p className="mt-0.5 truncate text-[11px] text-techto-muted">{detail}</p>}
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
    </GlassPanel>
  );
}
