"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, History, MessageSquareText, Trophy, Users2 } from "lucide-react";
import { TorontoMapClient } from "@/components/map/TorontoMapClient";
import type { StationCrowdLevel } from "@/components/map/TorontoMap";
import { TopNavigation } from "@/components/navigation/TopNavigation";
import { MobileToolbar } from "@/components/mobile/MobileToolbar";
import { MobileBottomSheet } from "@/components/mobile/MobileBottomSheet";
import { StatusPill } from "@/components/primitives/StatusPill";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useMapStore } from "@/store/useMapStore";
import { useTechTOStore, type TechTOPanelFocus } from "@/store/useTechTOStore";
import { useBackboardRun } from "@/lib/techto/use-backboard-run";
import type { StoredTechTORun } from "@/lib/techto/run-history";
import { FLAGSHIP_SCENARIO_ID, requireScenario } from "@/data/transit/scenarios";
import { simulateTransit } from "@/lib/transit/simulator";

import { ScenarioPanel } from "@/components/techto/ScenarioPanel";
import { PlaybackControls } from "@/components/techto/PlaybackControls";
import { BaselinePanel } from "@/components/techto/BaselinePanel";
import { PolicyCandidates } from "@/components/techto/PolicyCandidates";
import { PolicyComparison } from "@/components/techto/PolicyComparison";
import { CohortReactionExplorer } from "@/components/techto/CohortReactionExplorer";
import { AgentCouncil } from "@/components/techto/AgentCouncil";
import { AgentTimeline } from "@/components/techto/AgentTimeline";
import { EvidenceDrawer } from "@/components/techto/EvidenceDrawer";
import { StressTestPanel } from "@/components/techto/StressTestPanel";
import { FinalRecommendation } from "@/components/techto/FinalRecommendation";
import { OperatorQuestionPanel } from "@/components/techto/OperatorQuestionPanel";
import { PreviousRunsPanel } from "@/components/techto/PreviousRunsPanel";
import { BackboardStatusPanel } from "@/components/techto/BackboardStatusPanel";
import { MapChatBar } from "@/components/chat/MapChatBar";
import { BuildingMiniChat } from "@/components/chat/BuildingMiniChat";

const BASELINE_SEED = 20260718;

const TABS: { key: TechTOPanelFocus; label: string; icon: typeof Users2 }[] = [
  { key: "chat", label: "Council", icon: Users2 },
  { key: "citizens", label: "Policy Lab", icon: MessageSquareText },
  { key: "recommendation", label: "Recommendation", icon: Trophy },
  { key: "history", label: "History", icon: History },
];

/**
 * TechTO's product shell: the MapLibre Toronto map is the dominant visual
 * plane, with the scenario/policy controls docked left and the Backboard
 * council docked right on desktop, collapsing into bottom sheets on mobile
 * (see MobileToolbar/MobileBottomSheet). Wires useMapStore, useTechTOStore,
 * and useBackboardRun together; the flagship demo scenario is fixed to
 * FLAGSHIP_SCENARIO_ID (docs/techto-implementation.md section 2).
 */
export function TechTOAppShell() {
  const scenario = useMemo(() => requireScenario(FLAGSHIP_SCENARIO_ID), []);
  const isMobile = useIsMobile();

  const setSelectedScenario = useMapStore((s) => s.setSelectedScenario);
  const panelFocus = useTechTOStore((s) => s.panelFocus);
  const setPanelFocus = useTechTOStore((s) => s.setPanelFocus);
  const selectedCandidateId = useTechTOStore((s) => s.selectedCandidateId);
  const setSelectedCandidate = useTechTOStore((s) => s.setSelectedCandidate);
  const setActiveRun = useTechTOStore((s) => s.setActiveRun);

  const run = useBackboardRun();
  const [includeWebSearch, setIncludeWebSearch] = useState(false);
  const [viewedRun, setViewedRun] = useState<StoredTechTORun | null>(null);
  const [mobileSheet, setMobileSheet] = useState<"scenario" | "council" | null>(null);

  useEffect(() => {
    setSelectedScenario(scenario.id);
  }, [scenario.id, setSelectedScenario]);

  const events = viewedRun ? viewedRun.events : run.events;
  const result = viewedRun ? viewedRun.result : run.result;
  const isRunning = viewedRun ? false : run.isRunning;
  const activeRunId = viewedRun ? viewedRun.runId : run.runId;

  useEffect(() => {
    if (run.runId) setActiveRun(run.runId);
  }, [run.runId, setActiveRun]);

  // Auto-select the top-ranked, non-disqualified candidate once a run's
  // ranking arrives, so the comparison/reaction/stress panels have
  // something to show without the planner having to click first.
  useEffect(() => {
    if (!result || selectedCandidateId) return;
    const top = result.ranking.find((entry) => !entry.disqualified) ?? result.ranking[0];
    if (top) setSelectedCandidate(top.interventionId);
  }, [result, selectedCandidateId, setSelectedCandidate]);

  function handleStart() {
    setViewedRun(null);
    setSelectedCandidate(null);
    run.start({ scenarioId: scenario.id, includeWebSearch });
  }

  function handleSelectRun(stored: StoredTechTORun) {
    setViewedRun(stored);
    setSelectedCandidate(null);
    setMobileSheet(null);
  }

  const stationCrowd: StationCrowdLevel[] = useMemo(() => {
    const candidateSimulation = result?.simulations.find((entry) => entry.candidateId === selectedCandidateId);
    const source =
      candidateSimulation?.result ??
      simulateTransit({ schemaVersion: 1, scenario, intervention: null, stressOverlay: null, seed: BASELINE_SEED });
    const loads = source.departureLoads;
    if (loads.length === 0) return [];
    const avgLoad = loads.reduce((sum, load) => sum + load.loadFactor, 0) / loads.length;
    return [{ stationId: scenario.stationId, loadFactor: avgLoad }];
  }, [result, selectedCandidateId, scenario]);

  const rightPanelContent = (
    <div className="flex h-full flex-col gap-2">
      <div className="grid grid-cols-4 gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setPanelFocus(key)}
            className={
              "flex flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 text-[10px] font-medium transition-colors " +
              (panelFocus === key ? "bg-techto-accent/15 text-techto-accent" : "text-techto-muted hover:text-techto-text")
            }
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1">
        {panelFocus === "chat" && (
          <div className="grid h-full grid-rows-3 gap-2">
            <AgentCouncil events={events} />
            <AgentTimeline events={events} isRunning={isRunning} />
            <EvidenceDrawer events={events} />
          </div>
        )}
        {panelFocus === "citizens" && (
          <div className="grid h-full grid-rows-3 gap-2">
            <PolicyComparison scenario={scenario} result={result} selectedCandidateId={selectedCandidateId} />
            <CohortReactionExplorer result={result} selectedCandidateId={selectedCandidateId} />
            <StressTestPanel result={result} selectedCandidateId={selectedCandidateId} />
          </div>
        )}
        {panelFocus === "recommendation" && (
          <div className="grid h-full grid-rows-2 gap-2">
            <FinalRecommendation result={result} />
            <OperatorQuestionPanel scenarioId={scenario.id} result={result} />
          </div>
        )}
        {panelFocus === "history" && (
          <div className="grid h-full grid-rows-2 gap-2">
            <PreviousRunsPanel scenarioId={scenario.id} onSelectRun={handleSelectRun} activeRunId={activeRunId} />
            <BackboardStatusPanel />
          </div>
        )}
        {panelFocus === "map" && null}
      </div>
    </div>
  );

  const leftPanelContent = (
    <div className="flex h-full flex-col gap-2 overflow-y-auto pr-0.5 techto-scroll">
      <ScenarioPanel
        scenario={scenario}
        isRunning={isRunning}
        onStart={handleStart}
        onCancel={run.cancel}
        includeWebSearch={includeWebSearch}
        onIncludeWebSearchChange={setIncludeWebSearch}
      />
      {run.error && !viewedRun && (
        <div className="flex items-start gap-2 rounded-xl border border-techto-error/30 bg-techto-error/[0.08] px-3 py-2 text-xs text-techto-error">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {run.error}
        </div>
      )}
      <BaselinePanel scenario={scenario} problemSummary={result?.problemSummary} baselineSummary={result?.baselineSummary} />
      <PolicyCandidates
        candidates={result?.candidates ?? []}
        ranking={result?.ranking ?? []}
        selectedCandidateId={selectedCandidateId}
        onSelectCandidate={setSelectedCandidate}
      />
    </div>
  );

  return (
    <main className="relative h-dvh w-screen overflow-hidden bg-techto-ink" data-testid="techto-app">
      <div className="absolute inset-0">
        <TorontoMapClient stationCrowd={stationCrowd} />
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-col gap-2 p-3 sm:p-4">
        <TopNavigation
          contextSlot={
            <div>
              <p className="text-sm font-medium text-techto-text">{scenario.label}</p>
              <p className="text-[10px] text-techto-muted">Union · Line 1 · synthetic-fixture demo</p>
            </div>
          }
          statusSlot={
            <>
              <StatusPill tone={isRunning ? "loading" : "ready"}>{isRunning ? "Run in progress" : "Idle"}</StatusPill>
            </>
          }
        />
      </div>

      {!isMobile && (
        <>
          <div className="pointer-events-none absolute inset-y-0 left-0 z-10 flex w-[360px] flex-col gap-2 p-3 pt-24 sm:p-4 sm:pt-28">
            <div className="pointer-events-auto flex-1 min-h-0">{leftPanelContent}</div>
          </div>
          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 flex w-[380px] flex-col gap-2 p-3 pt-24 sm:p-4 sm:pt-28">
            <div className="pointer-events-auto flex-1 min-h-0">{rightPanelContent}</div>
          </div>
          <BuildingMiniChat />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-2 p-3 sm:p-4">
            <div className="pointer-events-auto w-[min(92vw,640px)]">
              <PlaybackControls scenario={scenario} />
            </div>
            <div className="pointer-events-auto w-full">
              <MapChatBar run={run} includeWebSearch={includeWebSearch} />
            </div>
          </div>
        </>
      )}

      {isMobile && (
        <>
          <BuildingMiniChat />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-2 p-3">
            <div className="pointer-events-auto w-full">
              <MapChatBar run={run} includeWebSearch={includeWebSearch} />
            </div>
            <div className="pointer-events-auto w-full">
              <PlaybackControls scenario={scenario} />
            </div>
            <div className="pointer-events-auto">
              <MobileToolbar onOpenScenario={() => setMobileSheet("scenario")} onOpenCouncil={() => setMobileSheet("council")} />
            </div>
          </div>

          <MobileBottomSheet open={mobileSheet === "scenario"} onClose={() => setMobileSheet(null)} title="Scenario & Policies" testId="mobile-scenario-sheet">
            <div className="max-h-[60vh] overflow-y-auto techto-scroll">{leftPanelContent}</div>
          </MobileBottomSheet>
          <MobileBottomSheet open={mobileSheet === "council"} onClose={() => setMobileSheet(null)} title="Agent Council" testId="mobile-council-sheet">
            <div className="max-h-[60vh] overflow-y-auto techto-scroll">{rightPanelContent}</div>
          </MobileBottomSheet>
        </>
      )}
    </main>
  );
}
