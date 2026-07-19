"use client";

import { CheckCircle2, Loader2, Users2, XCircle } from "lucide-react";
import { GlassPanel } from "@/components/primitives/GlassPanel";
import { EmptyState } from "@/components/feedback/EmptyState";
import {
  ASSISTANT_ROSTER,
  ASSISTANT_UI_GROUPS,
  type TwinTOAssistantKey,
} from "@/lib/backboard/assistants";
import type { TwinTORunEvent } from "@/lib/twinto/types";

type AgentStatus = "idle" | "started" | "completed" | "failed";

function statusFromEvents(events: TwinTORunEvent[]): Map<string, AgentStatus> {
  const status = new Map<string, AgentStatus>();
  for (const event of events) {
    if (event.type === "agent.started") status.set(event.role, "started");
    else if (event.type === "agent.completed") status.set(event.role, "completed");
    else if (event.type === "agent.failed") status.set(event.role, "failed");
  }
  return status;
}

const STATUS_ICON: Record<AgentStatus, typeof CheckCircle2> = {
  idle: Users2,
  started: Loader2,
  completed: CheckCircle2,
  failed: XCircle,
};

const STATUS_COLOR: Record<AgentStatus, string> = {
  idle: "text-twinto-muted",
  started: "text-twinto-amber",
  completed: "text-twinto-teal",
  failed: "text-twinto-error",
};

export interface AgentCouncilProps {
  events: TwinTORunEvent[];
}

/**
 * Consolidated 16-agent council view, grouped by Conversation / Planning /
 * Analysis / Validation / Decision. Only activated roles light up during a run.
 */
export function AgentCouncil({ events }: AgentCouncilProps) {
  const statusByRole = statusFromEvents(events);
  const activated = statusByRole.size;

  return (
    <GlassPanel className="flex h-full flex-col p-4" data-testid="agent-council">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Users2 className="h-4 w-4 text-twinto-accent" />
          <h3 className="text-sm font-semibold text-twinto-text">Agent Council</h3>
        </div>
        <span className="text-[11px] text-twinto-muted" data-testid="roster-version">
          roster v3 · 16 assistants · {activated} active
        </span>
      </div>

      {activated === 0 ? (
        <div className="mt-3 flex-1">
          <EmptyState
            title="No agents active"
            description="Ask City Copilot a question or start a planning run. Only the specialists needed for that intent will activate."
          />
        </div>
      ) : (
        <div className="mt-3 flex-1 space-y-3 overflow-y-auto pr-1 twinto-scroll">
          {(Object.entries(ASSISTANT_UI_GROUPS) as [string, readonly TwinTOAssistantKey[]][]).map(
            ([group, keys]) => {
              const activeInGroup = keys.filter((key) => statusByRole.has(key));
              if (activeInGroup.length === 0) return null;
              return (
                <section key={group}>
                  <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-twinto-muted">
                    {group}
                  </h4>
                  <ul className="space-y-1.5">
                    {activeInGroup.map((key) => {
                      const status = statusByRole.get(key) ?? "idle";
                      const Icon = STATUS_ICON[status];
                      const definition = ASSISTANT_ROSTER[key];
                      return (
                        <li
                          key={key}
                          className="rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-2"
                          data-testid={`agent-${key}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-twinto-text">
                              <Icon
                                className={`h-3 w-3 ${STATUS_COLOR[status]} ${status === "started" ? "animate-spin" : ""}`}
                              />
                              {definition.name.replace(/^(?:TwinTO|TechTO) — /, "")}
                            </span>
                          </div>
                          <p className="mt-0.5 text-[11px] text-twinto-muted">{definition.shortDescription}</p>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            },
          )}
        </div>
      )}
    </GlassPanel>
  );
}
