"use client";

import { Bus, Route, TrainFront, Users } from "lucide-react";
import { useMapStore } from "@/store/useMapStore";
import { GlassPanel } from "@/components/primitives/GlassPanel";
import { Toggle } from "@/components/primitives/Toggle";

const ROUTE_SWATCHES: { label: string; color: string; icon: typeof TrainFront }[] = [
  { label: "Line 1 (subway)", color: "#F8A200", icon: TrainFront },
  { label: "501 Queen (streetcar)", color: "#C81E3A", icon: Route },
  { label: "6A feeder (bus)", color: "#2E7D32", icon: Bus },
];

/** Route-color key plus the layer toggles for the overlays TorontoMap renders; doubles as a small legend and control surface. */
export function MapLegend() {
  const layers = useMapStore((s) => s.layers);
  const toggleLayer = useMapStore((s) => s.toggleLayer);

  return (
    <GlassPanel className="pointer-events-auto w-[min(88vw,260px)] p-3">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-twinto-muted">
        Toronto only · synthetic-fixture
      </p>
      <p className="mt-1 text-[10px] leading-snug text-twinto-muted">
        All planning and agent suggestions stay inside the City of Toronto.
      </p>
      <ul className="mt-2 space-y-1">
        {ROUTE_SWATCHES.map(({ label, color, icon: Icon }) => (
          <li key={label} className="flex items-center gap-2 text-xs text-twinto-text">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
            <Icon className="h-3.5 w-3.5 text-twinto-muted" />
            {label}
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-col gap-0.5 border-t border-white/10 pt-2">
        <Toggle
          label="Transit routes"
          checked={layers.transit}
          onChange={(checked) => toggleLayer("transit", checked)}
        />
        <Toggle
          label="Citizen density"
          description="Cohort home zones"
          checked={layers.parcels}
          onChange={(checked) => toggleLayer("parcels", checked)}
        />
        <Toggle
          label="Crowd heatmap"
          description="Station load factor"
          checked={layers.sentimentHeatmap}
          onChange={(checked) => toggleLayer("sentimentHeatmap", checked)}
        />
        <Toggle
          label="Events & incidents"
          checked={layers.policyOverlay}
          onChange={(checked) => toggleLayer("policyOverlay", checked)}
        />
      </div>

      <p className="mt-2 flex items-center gap-1 text-[10px] text-twinto-muted">
        <Users className="h-3 w-3" />
        Simulated citizens, not real Toronto residents.
      </p>
    </GlassPanel>
  );
}
