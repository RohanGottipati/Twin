"use client";

import { useEffect, useRef, useState } from "react";
import { SCENARIOS } from "@/lib/sim/scenarios";
import { useSimStore } from "@/store/useSimStore";
import { cn } from "@/lib/utils/cn";

const BASELINE = SCENARIOS.find((s) => s.kind === "baseline") ?? SCENARIOS[0];
const MOCK_SCENARIOS = SCENARIOS.filter((s) => s.id !== BASELINE.id);

/**
 * Top-of-screen scenario switcher: only "Baseline" (the real, unmodified
 * city) is a first-class tab. The fixed demo interventions (waterfront LRT,
 * King St priority, etc.) are illustrative fixtures, not real proposals --
 * they live behind a "Mock scenarios" disclosure instead of sitting in the
 * main interface, so they never read as if they were live analysis output.
 */
export function ScenarioPanel() {
  const scenarioId = useSimStore((s) => s.scenarioId);
  const setScenario = useSimStore((s) => s.setScenario);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const activeMock = MOCK_SCENARIOS.find((s) => s.id === scenarioId);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  return (
    <div
      className="pointer-events-auto flex items-stretch divide-x divide-hairline border border-hairline bg-panel"
      role="tablist"
      aria-label="City scenario"
    >
      <ScenarioTab
        label={BASELINE.name}
        accent={BASELINE.accent}
        summary={BASELINE.summary}
        isActive={scenarioId === BASELINE.id}
        onClick={() => setScenario(BASELINE.id)}
      />
      {activeMock && (
        <ScenarioTab
          label={activeMock.name}
          accent={activeMock.accent}
          summary={activeMock.summary}
          isActive
          onClick={() => setScenario(activeMock.id)}
        />
      )}
      <div ref={menuRef} className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-expanded={menuOpen}
          className="flex h-full items-center gap-1 px-3 py-1.5 text-[11px] uppercase tracking-wider text-muted transition-colors hover:bg-white/[0.03] hover:text-ink-dim"
        >
          Mock scenarios
          <span aria-hidden>{menuOpen ? "▴" : "▾"}</span>
        </button>
        {menuOpen && (
          <div className="absolute left-0 top-full z-10 mt-1 min-w-[220px] border border-hairline bg-panel">
            {MOCK_SCENARIOS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  setScenario(s.id);
                  setMenuOpen(false);
                }}
                title={s.summary}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11.5px] transition-colors",
                  s.id === scenarioId ? "bg-white/[0.06] text-ink-bright" : "text-ink-dim hover:bg-white/[0.03]",
                )}
              >
                <span aria-hidden className="h-[8px] w-[8px] shrink-0" style={{ backgroundColor: s.accent }} />
                {s.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ScenarioTab({
  label,
  accent,
  summary,
  isActive,
  onClick,
}: {
  label: string;
  accent: string;
  summary: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      onClick={onClick}
      title={summary}
      className={cn(
        "flex flex-col items-start gap-0.5 px-3 py-1.5 text-left transition-colors",
        isActive ? "bg-white/[0.06]" : "hover:bg-white/[0.03]",
      )}
    >
      <span aria-hidden className="h-[3px] w-full shrink-0 transition-colors" style={{ backgroundColor: isActive ? accent : "transparent" }} />
      <span className={cn("whitespace-nowrap text-[11.5px] leading-tight", isActive ? "text-ink-bright" : "text-ink-dim")}>
        {label}
      </span>
    </button>
  );
}
