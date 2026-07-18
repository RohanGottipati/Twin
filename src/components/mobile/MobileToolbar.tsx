"use client";

import {
  Building2,
  Globe,
  Layers,
  List,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useWorldStore } from "@/store/useWorldStore";
import { useSceneController } from "@/components/world/SceneControllerContext";
import { GlassPanel } from "@/components/primitives/GlassPanel";
import { IconButton } from "@/components/primitives/IconButton";

type MobileToolbarProps = {
  onOpenExplorer: () => void;
};

export function MobileToolbar({ onOpenExplorer }: MobileToolbarProps) {
  const mode = useWorldStore((s) => s.mode);
  const isFlying = useWorldStore((s) => s.isFlying);
  const toggleLayer = useWorldStore((s) => s.toggleLayerPanel);
  const isLayerPanelOpen = useWorldStore((s) => s.isLayerPanelOpen);
  const controller = useSceneController();

  const isWorld = mode === "world";

  return (
    <GlassPanel className="pointer-events-auto flex items-center gap-1.5 p-1.5">
      {isWorld ? (
        <IconButton
          label="Open city explorer"
          icon={<List className="h-5 w-5" />}
          onClick={onOpenExplorer}
          showTooltip={false}
        />
      ) : (
        <IconButton
          label="World view"
          icon={<Globe className="h-5 w-5" />}
          onClick={controller.goToWorld}
          disabled={isFlying}
          showTooltip={false}
        />
      )}
      {!isWorld && (
        <IconButton
          label="Toronto city view"
          icon={<Building2 className="h-5 w-5" />}
          onClick={controller.goToCity}
          active={mode === "city"}
          disabled={isFlying}
          showTooltip={false}
        />
      )}
      <IconButton
        label="Zoom in"
        icon={<ZoomIn className="h-5 w-5" />}
        onClick={controller.zoomIn}
        showTooltip={false}
      />
      <IconButton
        label="Zoom out"
        icon={<ZoomOut className="h-5 w-5" />}
        onClick={controller.zoomOut}
        showTooltip={false}
      />
      <IconButton
        label="Layers"
        icon={<Layers className="h-5 w-5" />}
        onClick={() => toggleLayer()}
        active={isLayerPanelOpen}
        showTooltip={false}
      />
    </GlassPanel>
  );
}
