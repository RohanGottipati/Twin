"use client";

import {
  Building2,
  Compass,
  Globe,
  Layers,
  HelpCircle,
  Maximize2,
  Building,
  Landmark,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useWorldStore } from "@/store/useWorldStore";
import { useSceneController } from "@/components/world/SceneControllerContext";
import { GlassPanel } from "@/components/primitives/GlassPanel";
import { IconButton } from "@/components/primitives/IconButton";

export function CameraControlRail() {
  const mode = useWorldStore((s) => s.mode);
  const isFlying = useWorldStore((s) => s.isFlying);
  const isLayerPanelOpen = useWorldStore((s) => s.isLayerPanelOpen);
  const isHelpPanelOpen = useWorldStore((s) => s.isHelpPanelOpen);
  const toggleLayer = useWorldStore((s) => s.toggleLayerPanel);
  const toggleHelp = useWorldStore((s) => s.toggleHelpPanel);
  const controller = useSceneController();

  return (
    <GlassPanel className="pointer-events-auto flex flex-col gap-1.5 p-1.5">
      <IconButton
        label="World view"
        icon={<Globe className="h-5 w-5" />}
        onClick={controller.goToWorld}
        active={mode === "world"}
        disabled={isFlying}
      />
      <div className="my-0.5 h-px bg-white/10" />
      <IconButton
        label="Toronto overview"
        icon={<Landmark className="h-5 w-5" />}
        onClick={controller.goToCityOverview}
        active={mode === "city-overview"}
        disabled={isFlying}
      />
      <IconButton
        label="Toronto city view"
        icon={<Building2 className="h-5 w-5" />}
        onClick={controller.goToCity}
        active={mode === "city"}
        disabled={isFlying}
      />
      <IconButton
        label="Toronto close view"
        icon={<Building className="h-5 w-5" />}
        onClick={controller.goToCityClose}
        active={mode === "city-close"}
        disabled={isFlying}
      />
      <div className="my-0.5 h-px bg-white/10" />
      <IconButton
        label="Zoom in"
        icon={<ZoomIn className="h-5 w-5" />}
        onClick={controller.zoomIn}
      />
      <IconButton
        label="Zoom out"
        icon={<ZoomOut className="h-5 w-5" />}
        onClick={controller.zoomOut}
      />
      <IconButton
        label="Reset north"
        icon={<Compass className="h-5 w-5" />}
        onClick={controller.resetNorth}
      />
      <div className="my-0.5 h-px bg-white/10" />
      <IconButton
        label="Layers"
        icon={<Layers className="h-5 w-5" />}
        onClick={() => toggleLayer()}
        active={isLayerPanelOpen}
      />
      <IconButton
        label="Help"
        icon={<HelpCircle className="h-5 w-5" />}
        onClick={() => toggleHelp()}
        active={isHelpPanelOpen}
      />
      <IconButton
        label="Fullscreen"
        icon={<Maximize2 className="h-5 w-5" />}
        onClick={controller.toggleFullscreen}
      />
    </GlassPanel>
  );
}
