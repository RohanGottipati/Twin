"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { GlassPanel } from "@/components/primitives/GlassPanel";
import { EmptyState } from "@/components/feedback/EmptyState";
import { AgentTimeline } from "@/components/techto/AgentTimeline";
import { FinalRecommendation } from "@/components/techto/FinalRecommendation";
import { loadRunHistory, type StoredTechTORun } from "@/lib/techto/run-history";

/**
 * A lightweight, read-only view of one stored run (identified by
 * `simulationId` = the run's `runId`), for sharing or revisiting a past
 * result without re-opening the full product shell. Run history lives only
 * in this browser's localStorage (see `@/lib/techto/run-history`), so a
 * run id from another device or a cleared browser will simply show "not
 * found" rather than fetching anything from a server.
 */
export default function SimulationPage() {
  const params = useParams<{ simulationId: string }>();
  const simulationId = params.simulationId;
  const [run, setRun] = useState<StoredTechTORun | null | undefined>(undefined);

  useEffect(() => {
    const found = loadRunHistory().find((entry) => entry.runId === simulationId);
    setRun(found ?? null);
  }, [simulationId]);

  return (
    <main className="h-dvh w-screen overflow-y-auto bg-techto-ink p-4 sm:p-8">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 self-start text-sm text-techto-muted transition-colors hover:text-techto-text"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to TechTO
        </Link>

        {run === undefined && <GlassPanel className="p-6 text-sm text-techto-muted">Loading stored run…</GlassPanel>}

        {run === null && (
          <GlassPanel className="p-6">
            <EmptyState
              title="Run not found in this browser"
              description={`No stored run matches "${simulationId}" here. Run history is saved per-browser; open TechTO and start or select a run instead.`}
            />
          </GlassPanel>
        )}

        {run && (
          <>
            <GlassPanel className="p-4">
              <p className="text-xs uppercase tracking-widest text-techto-muted">Stored run</p>
              <h1 className="mt-1 text-lg font-semibold text-techto-text">{run.scenarioId}</h1>
              <p className="mt-1 text-xs text-techto-muted">
                {run.runId} · {run.status} · started {new Date(run.startedAt).toLocaleString()}
              </p>
            </GlassPanel>
            <div className="h-[420px]">
              <FinalRecommendation result={run.result} />
            </div>
            <div className="h-[420px]">
              <AgentTimeline events={run.events} isRunning={false} />
            </div>
          </>
        )}
      </div>
    </main>
  );
}
