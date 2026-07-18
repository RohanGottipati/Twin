"use client";

import { useCallback, useMemo, useState } from "react";
import { useWorldStore } from "@/store/useWorldStore";
import { useSceneController } from "./SceneControllerContext";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { TopNavigation } from "@/components/navigation/TopNavigation";
import { CityExplorer } from "@/components/navigation/CityExplorer";
import { CityPreviewCard } from "@/components/navigation/CityPreviewCard";
import { CameraControlRail } from "@/components/navigation/CameraControlRail";
import { CameraStatus } from "@/components/navigation/CameraStatus";
import { LayerPanel } from "@/components/panels/LayerPanel";
import { BuildingDrawer } from "@/components/panels/BuildingDrawer";
import { HelpPanel } from "@/components/panels/HelpPanel";
import { SceneLoadingScreen } from "@/components/feedback/SceneLoadingScreen";
import { SceneErrorOverlay } from "@/components/feedback/SceneErrorOverlay";
import { MobileToolbar } from "@/components/mobile/MobileToolbar";
import { MobileBottomSheet } from "@/components/mobile/MobileBottomSheet";

export function WorldAppShell() {
  const controller = useSceneController();
  const isDesktop = useIsDesktop();

  const mode = useWorldStore((s) => s.mode);
  const isSceneReady = useWorldStore((s) => s.isSceneReady);
  const isSceneLoading = useWorldStore((s) => s.isSceneLoading);
  const loadingStage = useWorldStore((s) => s.loadingStage);
  const sceneError = useWorldStore((s) => s.sceneError);
  const selectedBuilding = useWorldStore((s) => s.selectedBuilding);
  const previewCityId = useWorldStore((s) => s.previewCityId);
  const isLayerPanelOpen = useWorldStore((s) => s.isLayerPanelOpen);
  const isHelpPanelOpen = useWorldStore((s) => s.isHelpPanelOpen);

  const clearSelectedBuilding = useWorldStore(
    (s) => s.clearSelectedBuilding
  );
  const setPreviewCity = useWorldStore((s) => s.setPreviewCity);
  const toggleLayerPanel = useWorldStore((s) => s.toggleLayerPanel);
  const toggleHelpPanel = useWorldStore((s) => s.toggleHelpPanel);

  const [mobileExplorerOpen, setMobileExplorerOpen] = useState(false);

  const handleEscape = useCallback(() => {
    if (selectedBuilding) {
      clearSelectedBuilding();
      return;
    }
    if (isHelpPanelOpen) {
      toggleHelpPanel(false);
      return;
    }
    if (isLayerPanelOpen) {
      toggleLayerPanel(false);
      return;
    }
    if (previewCityId) {
      setPreviewCity(null);
      return;
    }
    if (mobileExplorerOpen) {
      setMobileExplorerOpen(false);
      return;
    }
    if (mode !== "world") {
      controller.goToWorld();
    }
  }, [
    selectedBuilding,
    isHelpPanelOpen,
    isLayerPanelOpen,
    previewCityId,
    mobileExplorerOpen,
    mode,
    clearSelectedBuilding,
    toggleHelpPanel,
    toggleLayerPanel,
    setPreviewCity,
    controller,
  ]);

  const shortcutHandlers = useMemo(
    () => ({
      onWorld: () => controller.goToWorld(),
      onToronto: () => controller.previewCity("toronto"),
      onTorontoOverview: () => controller.goToCityOverview(),
      onTorontoCity: () => controller.goToCity(),
      onTorontoClose: () => controller.goToCityClose(),
      onToggleLayers: () => toggleLayerPanel(),
      onToggleHelp: () => toggleHelpPanel(),
      onResetView: () => controller.resetView(),
      onResetNorth: () => controller.resetNorth(),
      onEscape: () => handleEscape(),
    }),
    [controller, toggleLayerPanel, toggleHelpPanel, handleEscape]
  );

  useKeyboardShortcuts(shortcutHandlers);

  const isWorld = mode === "world";

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {/* Top navigation */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 p-3 sm:p-4"
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
      >
        <TopNavigation />
      </div>

      {/* Desktop: left city explorer (world mode only) */}
      {isDesktop && isWorld && (
        <div className="pointer-events-none absolute left-4 top-24 bottom-24">
          <CityExplorer />
        </div>
      )}

      {/* Desktop: right control rail */}
      {isDesktop && (
        <div className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2">
          <CameraControlRail />
        </div>
      )}

      {/* Desktop: bottom camera status */}
      {isDesktop && (
        <div className="pointer-events-none absolute bottom-4 left-4">
          <CameraStatus />
        </div>
      )}

      {/* City preview card (centered bottom) */}
      {previewCityId && (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center px-4 sm:bottom-8">
          <CityPreviewCard />
        </div>
      )}

      {/* Layer panel */}
      <div
        className="pointer-events-none absolute right-4 flex justify-end"
        style={{ top: "6.5rem" }}
      >
        <LayerPanel />
      </div>

      {/* Building drawer */}
      {isDesktop ? (
        <div className="pointer-events-none absolute right-4 top-24 flex justify-end">
          <BuildingDrawer />
        </div>
      ) : (
        <div className="pointer-events-none absolute inset-x-0 bottom-0">
          <BuildingDrawer />
        </div>
      )}

      {/* Mobile toolbar */}
      {!isDesktop && (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-3"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        >
          <MobileToolbar
            onOpenExplorer={() => setMobileExplorerOpen(true)}
          />
        </div>
      )}

      {/* Mobile city explorer bottom sheet */}
      {!isDesktop && (
        <MobileBottomSheet
          open={mobileExplorerOpen && isWorld}
          onClose={() => setMobileExplorerOpen(false)}
          title="Explore the world"
          testId="mobile-city-explorer"
        >
          <CityExplorer compact />
        </MobileBottomSheet>
      )}

      {/* Help panel (overlay) */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
        <HelpPanel />
      </div>

      {/* Loading + error overlays */}
      {isSceneLoading && !sceneError && (
        <div className="pointer-events-auto">
          <SceneLoadingScreen stage={loadingStage} />
        </div>
      )}

      {isSceneReady && !isSceneLoading && (
        <span className="sr-only" data-testid="world-ready" role="status">
          Scene ready
        </span>
      )}

      {sceneError?.critical && (
        <div className="pointer-events-auto">
          <SceneErrorOverlay
            title={sceneError.title}
            message={sceneError.message}
            onRetry={controller.retry}
            instructions={
              sceneError.title.includes("token") ? (
                <div>
                  <p className="font-medium text-[#F5F7FA]">
                    Add your Cesium ion token
                  </p>
                  <ol className="mt-2 list-decimal space-y-1 pl-4">
                    <li>
                      Copy <code>.env.example</code> to{" "}
                      <code>.env.local</code>.
                    </li>
                    <li>
                      Set{" "}
                      <code>NEXT_PUBLIC_CESIUM_ION_TOKEN</code> to your token.
                    </li>
                    <li>Restart the dev server.</li>
                  </ol>
                </div>
              ) : undefined
            }
          />
        </div>
      )}

      {/* Non-critical warning toast */}
      {sceneError && !sceneError.critical && (
        <div
          className="pointer-events-auto absolute inset-x-0 flex justify-center px-4"
          style={{ bottom: "6rem" }}
          role="status"
        >
          <div className="flex items-center gap-3 rounded-xl border border-[#F4B860]/40 bg-[rgba(8,13,21,0.9)] px-4 py-2 text-sm text-[#F4B860] backdrop-blur">
            <span>{sceneError.message}</span>
            <button
              type="button"
              onClick={() => useWorldStore.getState().setSceneError(null)}
              className="rounded-md px-2 py-0.5 text-xs text-[#9AA7B5] hover:text-[#F5F7FA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#55D8E6]"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
