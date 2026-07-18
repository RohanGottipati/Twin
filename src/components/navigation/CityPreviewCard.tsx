"use client";

import { AnimatePresence, motion } from "framer-motion";
import { MapPin, X } from "lucide-react";
import { useWorldStore } from "@/store/useWorldStore";
import { getCityById } from "@/config/cities/registry";
import { useSceneController } from "@/components/world/SceneControllerContext";
import { GlassPanel } from "@/components/primitives/GlassPanel";
import { formatCoordinate } from "@/lib/utils/format";
import { useReducedMotion } from "@/hooks/useReducedMotion";

export function CityPreviewCard() {
  const previewCityId = useWorldStore((s) => s.previewCityId);
  const setPreviewCity = useWorldStore((s) => s.setPreviewCity);
  const isFlying = useWorldStore((s) => s.isFlying);
  const controller = useSceneController();
  const reducedMotion = useReducedMotion();

  const city = previewCityId ? getCityById(previewCityId) : undefined;

  return (
    <AnimatePresence>
      {city && (
        <motion.div
          key={city.id}
          initial={reducedMotion ? false : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 24 }}
          transition={{ duration: 0.25 }}
          className="pointer-events-auto w-[min(92vw,420px)]"
          data-testid="city-preview-card"
        >
          <GlassPanel className="relative p-5">
            <button
              type="button"
              aria-label="Close preview"
              onClick={() => setPreviewCity(null)}
              className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#9AA7B5] transition-colors hover:bg-white/[0.06] hover:text-[#F5F7FA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#55D8E6]"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="flex items-center gap-2 text-[#55D8E6]">
              <MapPin className="h-4 w-4" />
              <span className="text-xs font-medium uppercase tracking-widest">
                {city.marker.label}
              </span>
            </div>
            <h2 className="mt-2 text-2xl font-semibold text-[#F5F7FA]">
              {city.name}
            </h2>
            <p className="text-sm text-[#9AA7B5]">
              {city.region}, {city.country}
            </p>
            <p className="mt-2 text-xs text-[#9AA7B5]">
              {formatCoordinate(city.coordinates.latitude)},{" "}
              {formatCoordinate(city.coordinates.longitude)}
            </p>

            <button
              type="button"
              onClick={() => controller.exploreCity(city.id)}
              disabled={isFlying}
              data-testid="explore-city-button"
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[#55D8E6]/50 bg-[#55D8E6]/20 px-4 py-2.5 text-sm font-semibold text-[#55D8E6] transition-colors hover:bg-[#55D8E6]/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#55D8E6] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Explore city
            </button>
          </GlassPanel>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
