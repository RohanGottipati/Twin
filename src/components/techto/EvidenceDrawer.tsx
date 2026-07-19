"use client";

import { CheckCircle2, FileSearch, XCircle } from "lucide-react";
import { GlassPanel } from "@/components/primitives/GlassPanel";
import { EmptyState } from "@/components/feedback/EmptyState";
import type { TechTORunEvent } from "@/lib/techto/types";

interface ToolCallEntry {
  role: string;
  toolName: string;
  ok: boolean | null;
}

function collectToolCalls(events: TechTORunEvent[]): ToolCallEntry[] {
  const entries: ToolCallEntry[] = [];
  for (const event of events) {
    if (event.type === "tool.requested") {
      entries.push({ role: event.role, toolName: event.toolName, ok: null });
    } else if (event.type === "tool.completed") {
      const pending = [...entries].reverse().find((entry) => entry.role === event.role && entry.toolName === event.toolName && entry.ok === null);
      if (pending) pending.ok = event.ok;
    }
  }
  return entries;
}

export interface EvidenceDrawerProps {
  events: TechTORunEvent[];
}

/** Every tool call an agent made this run, in order: the audit trail behind each finding (AGENTS.md 3.3, "the audit trail is the product"). */
export function EvidenceDrawer({ events }: EvidenceDrawerProps) {
  const calls = collectToolCalls(events);

  return (
    <GlassPanel className="flex h-full flex-col p-4" data-testid="evidence-drawer">
      <div className="flex items-center gap-2">
        <FileSearch className="h-4 w-4 text-techto-accent" />
        <h3 className="text-sm font-semibold text-techto-text">Evidence Trail</h3>
      </div>

      {calls.length === 0 ? (
        <div className="mt-3 flex-1">
          <EmptyState title="No tool calls yet" description="Every deterministic tool call agents make this run appears here as it happens." />
        </div>
      ) : (
        <ul className="mt-3 flex-1 space-y-1 overflow-y-auto pr-1 techto-scroll">
          {calls.map((call, index) => (
            <li
              key={index}
              className="flex items-center justify-between gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-1.5 text-xs"
            >
              <span className="min-w-0 truncate text-techto-text">
                <span className="font-mono text-[11px] text-techto-accent">{call.toolName}</span>
                <span className="text-techto-muted"> · {call.role}</span>
              </span>
              {call.ok === null ? (
                <span className="text-[10px] text-techto-muted">pending</span>
              ) : call.ok ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-techto-teal" />
              ) : (
                <XCircle className="h-3.5 w-3.5 shrink-0 text-techto-error" />
              )}
            </li>
          ))}
        </ul>
      )}
    </GlassPanel>
  );
}
