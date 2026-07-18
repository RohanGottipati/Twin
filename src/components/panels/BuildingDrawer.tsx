"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Copy, X } from "lucide-react";
import { useWorldStore } from "@/store/useWorldStore";
import { GlassPanel } from "@/components/primitives/GlassPanel";
import { formatCoordinate } from "@/lib/utils/format";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useReducedMotion } from "@/hooks/useReducedMotion";

export function BuildingDrawer() {
  const building = useWorldStore((s) => s.selectedBuilding);
  const clearSelectedBuilding = useWorldStore(
    (s) => s.clearSelectedBuilding
  );
  const isMobile = useIsMobile();
  const reducedMotion = useReducedMotion();
  const [showRaw, setShowRaw] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyCoordinates = async () => {
    if (!building) {
      return;
    }
    const text = `${building.latitude}, ${building.longitude}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const desktopMotion = {
    initial: reducedMotion ? false : { opacity: 0, x: 40 },
    animate: { opacity: 1, x: 0 },
    exit: reducedMotion ? { opacity: 0 } : { opacity: 0, x: 40 },
  };

  const mobileMotion = {
    initial: reducedMotion ? false : { opacity: 0, y: 60 },
    animate: { opacity: 1, y: 0 },
    exit: reducedMotion ? { opacity: 0 } : { opacity: 0, y: 60 },
  };

  return (
    <AnimatePresence>
      {building && (
        <motion.div
          {...(isMobile ? mobileMotion : desktopMotion)}
          transition={{ duration: 0.25 }}
          className={
            "pointer-events-auto " +
            (isMobile ? "w-full" : "w-[min(92vw,400px)]")
          }
          data-testid="building-drawer"
          role="dialog"
          aria-label="Selected building details"
        >
          <GlassPanel
            className={
              "flex flex-col overflow-hidden " +
              (isMobile ? "max-h-[70vh]" : "max-h-[calc(100dvh-9rem)]")
            }
          >
            <div className="flex items-start justify-between gap-3 border-b border-white/10 p-4">
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-widest text-[#55D8E6]">
                  Building
                </p>
                <h2 className="truncate text-lg font-semibold text-[#F5F7FA]">
                  {building.name}
                </h2>
              </div>
              <button
                type="button"
                aria-label="Close building details"
                onClick={clearSelectedBuilding}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#9AA7B5] transition-colors hover:bg-white/[0.06] hover:text-[#F5F7FA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#55D8E6]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              <dl className="flex flex-col gap-3 text-sm">
                {building.type && (
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-[#9AA7B5]">Type</dt>
                    <dd className="text-[#F5F7FA]">{building.type}</dd>
                  </div>
                )}
                {building.estimatedHeight !== null && (
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-[#9AA7B5]">Estimated height</dt>
                    <dd className="text-[#F5F7FA]">
                      {building.estimatedHeight.toLocaleString()} m
                    </dd>
                  </div>
                )}
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-[#9AA7B5]">Latitude</dt>
                  <dd className="text-[#F5F7FA]">
                    {formatCoordinate(building.latitude)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-[#9AA7B5]">Longitude</dt>
                  <dd className="text-[#F5F7FA]">
                    {formatCoordinate(building.longitude)}
                  </dd>
                </div>
              </dl>

              <button
                type="button"
                onClick={copyCoordinates}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-[#F5F7FA] transition-colors hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#55D8E6]"
              >
                <Copy className="h-4 w-4" />
                {copied ? "Copied" : "Copy coordinates"}
              </button>

              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => setShowRaw((v) => !v)}
                  aria-expanded={showRaw}
                  className="flex w-full items-center justify-between rounded-lg px-1 py-1 text-xs font-medium text-[#9AA7B5] transition-colors hover:text-[#F5F7FA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#55D8E6]"
                >
                  Raw metadata
                  <ChevronDown
                    className={
                      "h-4 w-4 transition-transform " +
                      (showRaw ? "rotate-180" : "")
                    }
                  />
                </button>
                {showRaw && (
                  <div className="mt-2 rounded-xl border border-white/10 bg-black/40 p-3">
                    {Object.keys(building.properties).length === 0 ? (
                      <p className="text-xs text-[#9AA7B5]">
                        No metadata available for this feature.
                      </p>
                    ) : (
                      <dl className="flex flex-col gap-1.5">
                        {Object.entries(building.properties).map(
                          ([key, value]) => (
                            <div
                              key={key}
                              className="flex items-start justify-between gap-3 text-[11px]"
                            >
                              <dt className="text-[#9AA7B5]">{key}</dt>
                              <dd className="max-w-[60%] break-words text-right text-[#F5F7FA]">
                                {String(value)}
                              </dd>
                            </div>
                          )
                        )}
                      </dl>
                    )}
                  </div>
                )}
              </div>
            </div>
          </GlassPanel>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
