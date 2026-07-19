"use client";

import { motion } from "framer-motion";
import { Award, ShieldAlert } from "lucide-react";
import { GlassPanel } from "@/components/primitives/GlassPanel";
import { EmptyState } from "@/components/feedback/EmptyState";
import { StatusPill } from "@/components/primitives/StatusPill";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import type { TechTORunResult } from "@/lib/techto/types";

const ACTION_LABEL: Record<string, string> = {
  approve: "Approve",
  approve_with_monitoring: "Approve with monitoring",
  hold_for_operator: "Hold for operator",
  reject_unsafe: "Reject as unsafe",
};

export interface FinalRecommendationProps {
  result: TechTORunResult | null;
}

/** The Final Policy Judge's decision, subject to the deterministic simulator/stress-tester's veto (AGENTS.md 3.2); `recommendationOverridden` means that veto fired. */
export function FinalRecommendation({ result }: FinalRecommendationProps) {
  const reducedMotion = useReducedMotion();

  return (
    <GlassPanel className="flex h-full flex-col p-4" data-testid="final-recommendation">
      <div className="flex items-center gap-2">
        <Award className="h-4 w-4 text-twinto-red" />
        <h3 className="text-sm font-semibold text-twinto-text">Final Recommendation</h3>
      </div>

      {!result ? (
        <div className="mt-3 flex-1">
          <EmptyState title="No recommendation yet" description="The Final Policy Judge's decision appears here once a run completes." />
        </div>
      ) : (
        <motion.div
          initial={reducedMotion ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="mt-3 flex-1 space-y-3 overflow-y-auto pr-1 techto-scroll"
        >
          {result.recommendationOverridden && (
            <div className="flex items-start gap-2 rounded-lg border border-techto-error/30 bg-techto-error/[0.06] px-3 py-2">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-techto-error" />
              <p className="text-xs text-techto-error">
                Deterministic override: the simulator/stress-tester overruled the AI recommendation.{" "}
                {result.overrideReason}
              </p>
            </div>
          )}

          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-techto-text">{result.effectiveRecommendation.headline}</span>
              <StatusPill tone={result.recommendationOverridden ? "error" : "ready"}>
                {ACTION_LABEL[result.effectiveRecommendation.recommendedAction] ?? result.effectiveRecommendation.recommendedAction}
              </StatusPill>
            </div>
            <p className="mt-1 text-xs text-techto-muted">
              Chosen candidate: {result.effectiveRecommendation.chosenCandidateId} · confidence{" "}
              {(result.effectiveRecommendation.confidence * 100).toFixed(0)}%
            </p>
          </div>

          <p className="text-sm leading-relaxed text-twinto-text/90">{result.effectiveRecommendation.reasoning}</p>

          {result.effectiveRecommendation.tradeoffs.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-techto-muted">Tradeoffs</p>
              <ul className="mt-1 space-y-1">
                {result.effectiveRecommendation.tradeoffs.map((tradeoff, index) => (
                  <li key={index} className="text-xs text-techto-text/80 before:mr-1.5 before:text-techto-accent before:content-['•']">
                    {tradeoff}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-[11px] leading-relaxed text-techto-muted">
            This is decision support over a simulated Toronto twin, not a live TTC control action: nothing here is
            sent to real schedules or vehicles. Citizen reactions are a simulated reading, never real public
            consultation.
          </p>
        </motion.div>
      )}
    </GlassPanel>
  );
}
