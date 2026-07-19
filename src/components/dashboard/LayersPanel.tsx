"use client";

import { useSimStore, type LayerKey } from "@/store/useSimStore";
import { cn } from "@/lib/utils/cn";

const LAYERS: Array<{ key: LayerKey; label: string; hint: string }> = [
  { key: "rail", label: "TTC rail", hint: "R" },
  { key: "streetcar", label: "Streetcars", hint: "S" },
  { key: "bus", label: "TTC buses", hint: "B" },
  { key: "personas", label: "Residents", hint: "P" },
  { key: "districts", label: "Neighbourhood sentiment", hint: "D" },
];

export function LayersPanel() {
  const layers = useSimStore((s) => s.layers);
  const toggleLayer = useSimStore((s) => s.toggleLayer);

  return (
    <section className="pointer-events-auto border border-hairline bg-panel">
      <h2 className="px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
        Layers
      </h2>
      <ul className="pb-2">
        {LAYERS.map(({ key, label }) => {
          const on = layers[key];
          return (
            <li key={key}>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                onClick={() => toggleLayer(key)}
                className="flex w-full items-center justify-between px-4 py-[7px] text-left hover:bg-white/[0.03]"
              >
                <span
                  className={cn(
                    "text-[12.5px]",
                    on ? "text-ink-dim" : "text-muted/70"
                  )}
                >
                  {label}
                </span>
                <span
                  aria-hidden
                  className={cn(
"relative h-[14px] w-[26px] border transition-colors",
                    on
                      ? "border-accent-magenta/60 bg-accent-magenta/25"
                      : "border-white/15 bg-white/5"
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-[2px] h-[8px] w-[8px] transition-all",
                      on ? "left-[14px] bg-accent-magenta" : "left-[3px] bg-white/40"
                    )}
                  />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
