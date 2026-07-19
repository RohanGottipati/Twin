"use client";

import { ShieldAlert, ShieldCheck } from "lucide-react";
import { GlassPanel } from "@/components/primitives/GlassPanel";
import { EmptyState } from "@/components/feedback/EmptyState";
import { StatusPill } from "@/components/primitives/StatusPill";
import type { TechTORunResult } from "@/lib/techto/types";

export interface StressTestPanelProps {
  result: TechTORunResult | null;
  selectedCandidateId: string | null;
}

/** Result of layering the concert-surge extenuating-circumstances overlay (docs/techto-implementation.md 2.5) on top of the selected candidate. */
export function StressTestPanel({ result, selectedCandidateId }: StressTestPanelProps) {
  const entry = result?.stressResults.find((item) => item.candidateId === selectedCandidateId) ?? null;

  return (
    <GlassPanel className="flex h-full flex-col p-4" data-testid="stress-test-panel">
      <div className="flex items-center gap-2">
        <ShieldAlert className="h-4 w-4 text-techto-accent" />
        <h3 className="text-sm font-semibold text-techto-text">Stress Test</h3>
      </div>

      {!entry ? (
        <div className="mt-3 flex-1">
          <EmptyState
            title="No stress-test evidence"
            description="Select a candidate that has been run against the concert-surge overlay (arrival surge, entrance closure, departure delay, connecting delay)."
          />
        </div>
      ) : (
        <div className="mt-3 flex-1 space-y-3 overflow-y-auto pr-1 techto-scroll">
          <div className="flex items-center gap-2">
            {entry.result.invalidated ? (
              <StatusPill tone="error">Invalidated under stress</StatusPill>
            ) : (
              <StatusPill tone="ready">Holds under stress</StatusPill>
            )}
          </div>

          {entry.result.invalidationReasons.length > 0 ? (
            <ul className="space-y-1.5">
              {entry.result.invalidationReasons.map((reason, index) => (
                <li key={index} className="flex items-start gap-1.5 text-xs text-techto-error">
                  <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {reason}
                </li>
              ))}
            </ul>
          ) : (
            <p className="flex items-start gap-1.5 text-xs text-techto-teal">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              No failures found under the concert-surge stress overlay.
            </p>
          )}

          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="rounded-lg border border-white/5 bg-white/[0.02] py-2">
              <p className="text-sm font-semibold text-techto-text">
                {entry.result.baseline.metrics.meanWaitMinutes.toFixed(1)}m
              </p>
              <p className="text-[10px] uppercase tracking-wide text-techto-muted">wait, no event</p>
            </div>
            <div className="rounded-lg border border-white/5 bg-white/[0.02] py-2">
              <p className="text-sm font-semibold text-techto-text">
                {entry.result.stressed.metrics.meanWaitMinutes.toFixed(1)}m
              </p>
              <p className="text-[10px] uppercase tracking-wide text-techto-muted">wait, under stress</p>
            </div>
          </div>
        </div>
      )}
    </GlassPanel>
  );
}
