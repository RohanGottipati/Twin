"use client";

import { useMemo, useState } from "react";
import { Globe2, Search } from "lucide-react";
import { getEnabledCities } from "@/config/cities/registry";
import { useSceneController } from "@/components/world/SceneControllerContext";
import { useWorldStore } from "@/store/useWorldStore";
import { GlassPanel } from "@/components/primitives/GlassPanel";
import { StatusPill } from "@/components/primitives/StatusPill";
import { EmptyState } from "@/components/feedback/EmptyState";

type CityExplorerProps = {
  compact?: boolean;
};

export function CityExplorer({ compact = false }: CityExplorerProps) {
  const [query, setQuery] = useState("");
  const controller = useSceneController();
  const previewCityId = useWorldStore((s) => s.previewCityId);

  const cities = useMemo(() => getEnabledCities(), []);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return cities;
    }
    return cities.filter((city) =>
      [city.name, city.region, city.country]
        .join(" ")
        .toLowerCase()
        .includes(normalized)
    );
  }, [cities, query]);

  return (
    <GlassPanel
      className={
        "pointer-events-auto flex flex-col " +
        (compact ? "p-4" : "w-[320px] p-5")
      }
      data-testid="city-explorer"
      aria-label="City explorer"
    >
      <div className="flex items-center gap-2 text-[#55D8E6]">
        <Globe2 className="h-5 w-5" />
        <span className="text-sm font-semibold tracking-wide text-[#F5F7FA]">
          Skyline
        </span>
      </div>
      <h2 className="mt-3 text-lg font-semibold text-[#F5F7FA]">
        Explore the world
      </h2>
      <p className="text-xs text-[#9AA7B5]">
        Select a configured city to fly in.
      </p>

      <div className="relative mt-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9AA7B5]" />
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search cities"
          aria-label="Search cities"
          className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-2 pl-9 pr-3 text-sm text-[#F5F7FA] placeholder:text-[#9AA7B5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#55D8E6]"
        />
      </div>

      <div className="mt-4 flex flex-col gap-2">
        {filtered.length === 0 ? (
          <EmptyState
            title="No cities found"
            description="Try a different search term."
          />
        ) : (
          filtered.map((city) => (
            <button
              key={city.id}
              type="button"
              onClick={() => controller.previewCity(city.id)}
              data-testid={`city-row-${city.id}`}
              aria-pressed={previewCityId === city.id}
              className={
                "flex items-center justify-between gap-3 rounded-xl border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#55D8E6] " +
                (previewCityId === city.id
                  ? "border-[#55D8E6]/50 bg-[#55D8E6]/10"
                  : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]")
              }
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium text-[#F5F7FA]">
                  {city.name}
                </span>
                <span className="block truncate text-xs text-[#9AA7B5]">
                  {city.name}, {city.region}, {city.country}
                </span>
              </span>
              <StatusPill tone="ready">Available</StatusPill>
            </button>
          ))
        )}
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-[#9AA7B5]">
        More cities can be added through the city registry — no renderer
        changes required.
      </p>
    </GlassPanel>
  );
}
