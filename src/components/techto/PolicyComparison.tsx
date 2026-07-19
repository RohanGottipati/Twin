"use client";

import { useMemo } from "react";
import { Scale } from "lucide-react";
import { GlassPanel } from "@/components/primitives/GlassPanel";
import { EmptyState } from "@/components/feedback/EmptyState";
import { WaitTimeChart, type WaitTimeChartEntry } from "@/components/techto/WaitTimeChart";
import { simulateTransit } from "@/lib/transit/simulator";
import type { TransitScenario } from "@/lib/transit/schemas";
import type { TechTORunResult } from "@/lib/techto/types";

const BASELINE_SEED = 20260718;

export interface PolicyComparisonProps {
  scenario: TransitScenario;
  result: TechTORunResult | null;
  selectedCandidateId: string | null;
}

const METRIC_ROWS: { key: keyof TechTORunResult["simulations"][number]["result"]["metrics"]; label: string; suffix?: string }[] = [
  { key: "meanWaitMinutes", label: "Mean wait", suffix: "min" },
  { key: "p90WaitMinutes", label: "P90 wait", suffix: "min" },
  { key: "deniedBoardings", label: "Denied boardings" },
  { key: "loadImbalance", label: "Load imbalance" },
  { key: "missedTransfers", label: "Missed transfers" },
  { key: "equityGap", label: "Equity gap" },
  { key: "estimatedCarbonKg", label: "Estimated carbon", suffix: "kg" },
  { key: "operatingCostScore", label: "Operating cost score" },
];

/** Baseline-vs-candidate metric table and wait-time chart; the "did this actually help" view. */
export function PolicyComparison({ scenario, result, selectedCandidateId }: PolicyComparisonProps) {
  const baseline = useMemo(
    () => simulateTransit({ schemaVersion: 1, scenario, intervention: null, stressOverlay: null, seed: BASELINE_SEED }),
    [scenario],
  );

  const selected = result?.simulations.find((entry) => entry.candidateId === selectedCandidateId) ?? null;

  const chartEntries: WaitTimeChartEntry[] = [
    { label: "Baseline", meanWaitMinutes: baseline.metrics.meanWaitMinutes, p90WaitMinutes: baseline.metrics.p90WaitMinutes },
    ...(result?.simulations.map((entry) => ({
      label: entry.candidateId,
      meanWaitMinutes: entry.result.metrics.meanWaitMinutes,
      p90WaitMinutes: entry.result.metrics.p90WaitMinutes,
    })) ?? []),
  ];

  return (
    <GlassPanel className="flex h-full flex-col p-4" data-testid="policy-comparison">
      <div className="flex items-center gap-2">
        <Scale className="h-4 w-4 text-techto-accent" />
        <h3 className="text-sm font-semibold text-techto-text">Policy Comparison</h3>
      </div>

      <div className="mt-3">
        <WaitTimeChart entries={chartEntries} />
      </div>

      {!selected ? (
        <div className="mt-3 flex-1">
          <EmptyState title="No candidate selected" description="Select a candidate from Policy Candidates to compare it against the baseline." />
        </div>
      ) : (
        <div className="mt-3 flex-1 overflow-y-auto techto-scroll">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-techto-muted">
                <th className="pb-1.5 font-medium">Metric</th>
                <th className="pb-1.5 font-medium text-right">Baseline</th>
                <th className="pb-1.5 font-medium text-right">{selected.candidateId}</th>
              </tr>
            </thead>
            <tbody>
              {METRIC_ROWS.map((row) => (
                <tr key={row.key} className="border-t border-white/5">
                  <td className="py-1.5 text-techto-muted">{row.label}</td>
                  <td className="py-1.5 text-right text-techto-text">
                    {baseline.metrics[row.key].toFixed(2)}
                    {row.suffix ? ` ${row.suffix}` : ""}
                  </td>
                  <td className="py-1.5 text-right text-techto-text">
                    {selected.result.metrics[row.key].toFixed(2)}
                    {row.suffix ? ` ${row.suffix}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </GlassPanel>
  );
}
