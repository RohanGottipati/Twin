"use client";

import { ArrowLeft, HelpCircle } from "lucide-react";
import { useWorldStore } from "@/store/useWorldStore";
import { getCityById } from "@/config/cities/registry";
import { useSceneController } from "@/components/world/SceneControllerContext";
import { GlassPanel } from "@/components/primitives/GlassPanel";
import { StatusPill } from "@/components/primitives/StatusPill";
import { IconButton } from "@/components/primitives/IconButton";

export function TopNavigation() {
  const mode = useWorldStore((s) => s.mode);
  const activeCityId = useWorldStore((s) => s.activeCityId);
  const isSceneReady = useWorldStore((s) => s.isSceneReady);
  const isSceneLoading = useWorldStore((s) => s.isSceneLoading);
  const toggleHelp = useWorldStore((s) => s.toggleHelpPanel);
  const isHelpOpen = useWorldStore((s) => s.isHelpPanelOpen);
  const controller = useSceneController();

  const isWorld = mode === "world";
  const activeCity = activeCityId ? getCityById(activeCityId) : undefined;

  return (
    <GlassPanel className="pointer-events-auto flex items-center justify-between gap-3 px-3 py-2 sm:px-4">
      <div className="flex items-center gap-3">
        {!isWorld && (
          <button
            type="button"
            onClick={controller.goToWorld}
            data-testid="back-to-world-button"
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm font-medium text-[#F5F7FA] transition-colors hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#55D8E6]"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Back to World</span>
          </button>
        )}
        <div className="leading-tight">
          <p className="text-sm font-semibold tracking-wide text-[#F5F7FA]">
            Skyline
          </p>
          <p className="text-[10px] uppercase tracking-widest text-[#9AA7B5]">
            {isWorld ? "World Explorer" : "City Explorer"}
          </p>
        </div>
      </div>

      <div className="hidden text-center sm:block">
        <p className="text-sm font-medium text-[#F5F7FA]">
          {isWorld ? "Global View" : (activeCity?.name ?? "City")}
        </p>
        {!isWorld && activeCity && (
          <p className="text-[10px] text-[#9AA7B5]">
            {activeCity.region}, {activeCity.country}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2">
        {isSceneReady && !isSceneLoading ? (
          <StatusPill tone="ready" className="hidden sm:inline-flex">
            Ready
          </StatusPill>
        ) : (
          <StatusPill tone="loading" className="hidden sm:inline-flex">
            Loading
          </StatusPill>
        )}
        <IconButton
          label="Toggle help"
          icon={<HelpCircle className="h-5 w-5" />}
          onClick={() => toggleHelp()}
          active={isHelpOpen}
          tooltipSide="bottom"
        />
      </div>
    </GlassPanel>
  );
}
