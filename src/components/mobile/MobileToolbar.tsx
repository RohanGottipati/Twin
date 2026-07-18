"use client";

import { Layers, List, MapPin, Users } from "lucide-react";
import { useMapStore } from "@/store/useMapStore";
import { GlassPanel } from "@/components/primitives/GlassPanel";
import { IconButton } from "@/components/primitives/IconButton";

type MobileToolbarProps = {
  onOpenScenario: () => void;
  onOpenCouncil: () => void;
};

/** Bottom action bar for small screens: opens the panels that stack full-screen on mobile instead of docking beside the map. */
export function MobileToolbar({ onOpenScenario, onOpenCouncil }: MobileToolbarProps) {
  const toggleLayer = useMapStore((s) => s.toggleLayer);
  const sentimentHeatmap = useMapStore((s) => s.layers.sentimentHeatmap);
  const selectedStationId = useMapStore((s) => s.selectedStationId);

  return (
    <GlassPanel className="pointer-events-auto flex items-center gap-1.5 p-1.5">
      <IconButton
        label="Scenario and policies"
        icon={<List className="h-5 w-5" />}
        onClick={onOpenScenario}
        showTooltip={false}
      />
      <IconButton
        label="Agent council"
        icon={<Users className="h-5 w-5" />}
        onClick={onOpenCouncil}
        showTooltip={false}
      />
      <IconButton
        label="Toggle sentiment heatmap"
        icon={<Layers className="h-5 w-5" />}
        onClick={() => toggleLayer("sentimentHeatmap")}
        active={sentimentHeatmap}
        showTooltip={false}
      />
      {selectedStationId && (
        <span className="ml-1 inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 text-[11px] text-twinto-muted">
          <MapPin className="h-3.5 w-3.5" />
          {selectedStationId}
        </span>
      )}
    </GlassPanel>
  );
}
