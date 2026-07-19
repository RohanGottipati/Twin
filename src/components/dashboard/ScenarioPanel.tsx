"use client";

import { useEffect } from "react";
import { SCENARIOS } from "@/lib/sim/scenarios";
import { useSimStore } from "@/store/useSimStore";
import { cn } from "@/lib/utils/cn";

const KIND_LABEL: Record<string, string> = {
  baseline: "baseline",
  corridor: "corridor",
  policy: "policy",
};

export function ScenarioPanel() {
  const scenarioId = useSimStore((s) => s.scenarioId);
  const setScenario = useSimStore((s) => s.setScenario);

  // Number keys 1..5 switch scenarios.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(input|textarea|select)$/i.test(target.tagName)) return;
      const idx = parseInt(e.key, 10) - 1;
      if (idx >= 0 && idx < SCENARIOS.length) {
        setScenario(SCENARIOS[idx].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setScenario]);

  const active = SCENARIOS.find((s) => s.id === scenarioId);

  return (
    <section className="pointer-events-auto border border-hairline bg-panel">
      <header className="flex items-baseline justify-between px-4 pb-1 pt-3">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
          Scenario
        </h2>
        <span className="font-mono text-[9px] text-muted/70">keys 1–5</span>
      </header>
      <ul>
        {SCENARIOS.map((s, i) => {
          const isActive = s.id === scenarioId;
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => setScenario(s.id)}
                aria-pressed={isActive}
                className={cn(
                  "group flex w-full items-center gap-3 px-4 py-[7px] text-left transition-colors",
                  isActive ? "bg-white/[0.06]" : "hover:bg-white/[0.03]"
                )}
              >
                <span
                  aria-hidden
 className="h-[18px] w-[3px] shrink-0 transition-colors"
                  style={{
                    backgroundColor: isActive ? s.accent : "transparent",
                  }}
                />
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block truncate text-[12.5px] leading-tight",
                      isActive ? "text-ink-bright" : "text-ink-dim"
                    )}
                  >
                    {s.name}
                  </span>
                </span>
                <span className="font-mono text-[9px] uppercase tracking-wider text-muted/60">
                  {i + 1}·{KIND_LABEL[s.kind]}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {active && (
        <p className="border-t border-hairline px-4 py-2.5 text-[11px] leading-snug text-muted">
          {active.summary}
        </p>
      )}
    </section>
  );
}
