"use client";

import { Users } from "lucide-react";
import { GlassPanel } from "@/components/primitives/GlassPanel";
import { EmptyState } from "@/components/feedback/EmptyState";
import { StatusPill } from "@/components/primitives/StatusPill";
import type { TechTORunResult } from "@/lib/techto/types";

export interface CohortReactionExplorerProps {
  result: TechTORunResult | null;
  selectedCandidateId: string | null;
}

/** Per-cohort simulated acceptance and rationale for the selected candidate, plus the population-weighted aggregate. Always labeled as a simulated reading, never real Toronto opinion. */
export function CohortReactionExplorer({ result, selectedCandidateId }: CohortReactionExplorerProps) {
  const entry = result?.citizenReactions.find((item) => item.candidateId === selectedCandidateId) ?? null;

  return (
    <GlassPanel className="flex h-full flex-col p-4" data-testid="cohort-reactions">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-techto-accent" />
          <h3 className="text-sm font-semibold text-techto-text">Cohort Reactions</h3>
        </div>
        {entry && (
          <StatusPill tone="ready">
            CitizenReactionLM
          </StatusPill>
        )}
      </div>

      {!entry ? (
        <div className="mt-3 flex-1">
          <EmptyState
            title="No cohort reactions yet"
            description="Select a candidate with completed citizen-reaction evidence to see per-cohort acceptance and rationale."
          />
        </div>
      ) : (
        <div className="mt-3 flex-1 space-y-3 overflow-y-auto pr-1 techto-scroll">
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="rounded-lg border border-white/5 bg-white/[0.02] py-2">
              <p className="text-lg font-semibold text-techto-text">
                {(entry.result.aggregate.populationWeightedAcceptance * 100).toFixed(0)}%
              </p>
              <p className="text-[10px] uppercase tracking-wide text-techto-muted">population-weighted acceptance</p>
            </div>
            <div className="rounded-lg border border-white/5 bg-white/[0.02] py-2">
              <p className="text-lg font-semibold text-techto-text">
                ±{entry.result.aggregate.stdDevAcceptance.toFixed(2)}
              </p>
              <p className="text-[10px] uppercase tracking-wide text-techto-muted">std. dev across cohorts</p>
            </div>
          </div>

          <p className="text-[11px] text-techto-muted">
            {entry.result.aggregate.acceptCount} accept · {entry.result.aggregate.neutralCount} neutral ·{" "}
            {entry.result.aggregate.rejectCount} reject, out of {entry.result.aggregate.cohortCount} cohorts. This is a
            simulated distribution, not a real public consultation result.
          </p>

          <ul className="space-y-2">
            {entry.result.reactions.map((reaction) => (
              <li key={reaction.cohortId} className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-techto-text">{reaction.cohortId}</span>
                  <span
                    className={
                      reaction.acceptance >= 0.6
                        ? "text-xs font-semibold text-techto-teal"
                        : reaction.acceptance <= 0.4
                          ? "text-xs font-semibold text-techto-error"
                          : "text-xs font-semibold text-techto-amber"
                    }
                  >
                    {(reaction.acceptance * 100).toFixed(0)}%
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-techto-muted">{reaction.rationale}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </GlassPanel>
  );
}
