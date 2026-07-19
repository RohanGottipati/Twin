"use client";

import { motion } from "framer-motion";
import { AlertOctagon, CheckCircle2, ListChecks } from "lucide-react";
import { GlassPanel } from "@/components/primitives/GlassPanel";
import { EmptyState } from "@/components/feedback/EmptyState";
import { StatusPill } from "@/components/primitives/StatusPill";
import { cn } from "@/lib/utils/cn";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import type { PolicyCandidate, TransitIntervention } from "@/lib/transit/schemas";

export interface PolicyCandidatesProps {
  candidates: TransitIntervention[];
  ranking: PolicyCandidate[];
  selectedCandidateId: string | null;
  onSelectCandidate: (interventionId: string) => void;
}

/** Every candidate the Intervention Generator proposed, deterministically ranked; selecting one drives PolicyComparison, CohortReactionExplorer, and StressTestPanel. */
export function PolicyCandidates({ candidates, ranking, selectedCandidateId, onSelectCandidate }: PolicyCandidatesProps) {
  const reducedMotion = useReducedMotion();
  const rankByInterventionId = new Map(ranking.map((entry) => [entry.interventionId, entry]));

  return (
    <GlassPanel className="flex h-full flex-col p-4" data-testid="policy-candidates">
      <div className="flex items-center gap-2">
        <ListChecks className="h-4 w-4 text-techto-accent" />
        <h3 className="text-sm font-semibold text-techto-text">Policy Candidates</h3>
      </div>

      {candidates.length === 0 ? (
        <div className="mt-3 flex-1">
          <EmptyState
            title="No candidates yet"
            description="Start a planning run to see the Intervention Generator's proposed schedule changes."
          />
        </div>
      ) : (
        <ul className="mt-3 flex-1 space-y-2 overflow-y-auto pr-1 techto-scroll">
          {candidates.map((candidate, index) => {
            const rank = rankByInterventionId.get(candidate.id);
            const isSelected = candidate.id === selectedCandidateId;
            return (
              <motion.li
                key={candidate.id}
                initial={reducedMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: reducedMotion ? 0 : index * 0.04 }}
              >
                <button
                  type="button"
                  onClick={() => onSelectCandidate(candidate.id)}
                  className={cn(
                    "w-full rounded-lg border px-3 py-2.5 text-left transition-colors",
                    isSelected
                      ? "border-techto-accent/50 bg-techto-accent/[0.08]"
                      : "border-white/5 bg-white/[0.02] hover:bg-white/[0.05]",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-techto-text">{candidate.label}</span>
                    {rank?.disqualified ? (
                      <StatusPill tone="error">Disqualified</StatusPill>
                    ) : rank ? (
                      <StatusPill tone="ready">Rank {rank.rank}</StatusPill>
                    ) : null}
                  </div>
                  {candidate.description && (
                    <p className="mt-1 text-[11px] leading-relaxed text-techto-muted">{candidate.description}</p>
                  )}
                  {rank?.disqualified && rank.disqualifyReason && (
                    <p className="mt-1 inline-flex items-start gap-1 text-[11px] text-techto-error">
                      <AlertOctagon className="mt-0.5 h-3 w-3 shrink-0" />
                      {rank.disqualifyReason}
                    </p>
                  )}
                  {rank && !rank.disqualified && (
                    <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-techto-muted">
                      <CheckCircle2 className="h-3 w-3 text-techto-teal" />
                      score {rank.score.toFixed(2)} · {rank.violationCount} violation(s)
                    </p>
                  )}
                </button>
              </motion.li>
            );
          })}
        </ul>
      )}
    </GlassPanel>
  );
}
