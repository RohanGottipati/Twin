"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useWorldStore } from "@/store/useWorldStore";
import { GlassPanel } from "@/components/primitives/GlassPanel";
import { Toggle } from "@/components/primitives/Toggle";
import { useReducedMotion } from "@/hooks/useReducedMotion";

export function LayerPanel() {
  const isOpen = useWorldStore((s) => s.isLayerPanelOpen);
  const toggleLayerPanel = useWorldStore((s) => s.toggleLayerPanel);
  const mode = useWorldStore((s) => s.mode);
  const reducedMotion = useReducedMotion();

  const terrainEnabled = useWorldStore((s) => s.terrainEnabled);
  const buildingsEnabled = useWorldStore((s) => s.buildingsEnabled);
  const cityMarkersEnabled = useWorldStore((s) => s.cityMarkersEnabled);
  const labelsEnabled = useWorldStore((s) => s.labelsEnabled);
  const atmosphereEnabled = useWorldStore((s) => s.atmosphereEnabled);
  const lightingEnabled = useWorldStore((s) => s.lightingEnabled);
  const globeRotationEnabled = useWorldStore((s) => s.globeRotationEnabled);

  const toggleTerrain = useWorldStore((s) => s.toggleTerrain);
  const toggleBuildings = useWorldStore((s) => s.toggleBuildings);
  const toggleCityMarkers = useWorldStore((s) => s.toggleCityMarkers);
  const toggleLabels = useWorldStore((s) => s.toggleLabels);
  const toggleAtmosphere = useWorldStore((s) => s.toggleAtmosphere);
  const toggleLighting = useWorldStore((s) => s.toggleLighting);
  const setGlobeRotation = useWorldStore((s) => s.setGlobeRotation);

  const isCityMode = mode !== "world";

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={reducedMotion ? false : { opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={reducedMotion ? { opacity: 0 } : { opacity: 0, x: 24 }}
          transition={{ duration: 0.2 }}
          className="pointer-events-auto w-[min(92vw,340px)]"
          data-testid="layer-panel"
          role="dialog"
          aria-label="Layer controls"
        >
          <GlassPanel className="max-h-[70vh] overflow-y-auto p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[#F5F7FA]">
                Layers
              </h2>
              <button
                type="button"
                aria-label="Close layers"
                onClick={() => toggleLayerPanel(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#9AA7B5] transition-colors hover:bg-white/[0.06] hover:text-[#F5F7FA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#55D8E6]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3 flex flex-col gap-1">
              <Toggle
                label="Terrain"
                description="Cesium World Terrain"
                checked={terrainEnabled}
                onChange={(v) => toggleTerrain(v)}
              />
              <Toggle
                label="3D Buildings"
                description="OpenStreetMap buildings"
                checked={buildingsEnabled}
                onChange={(v) => toggleBuildings(v)}
              />
              <Toggle
                label="City Markers"
                checked={cityMarkersEnabled}
                onChange={(v) => toggleCityMarkers(v)}
              />
              <Toggle
                label="City Labels"
                checked={labelsEnabled}
                onChange={(v) => toggleLabels(v)}
              />
              <Toggle
                label="Atmosphere and Fog"
                checked={atmosphereEnabled}
                onChange={(v) => toggleAtmosphere(v)}
              />
              <Toggle
                label="Globe Lighting"
                checked={lightingEnabled}
                onChange={(v) => toggleLighting(v)}
              />
              <Toggle
                label="Auto-Rotate Globe"
                description={
                  isCityMode
                    ? "Available in world mode"
                    : "Subtle idle rotation"
                }
                checked={globeRotationEnabled}
                onChange={(v) => setGlobeRotation(v)}
                disabled={isCityMode}
              />
            </div>

            <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-3 opacity-70">
              <p className="text-xs font-medium text-[#9AA7B5]">
                Custom data layers
              </p>
              <p className="mt-1 text-[11px] text-[#9AA7B5]">
                No additional data layers are connected.
              </p>
            </div>
          </GlassPanel>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
