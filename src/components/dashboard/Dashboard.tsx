"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MapCanvas } from "./MapCanvas";
import { ScenarioPanel } from "./ScenarioPanel";
import { LayersPanel } from "./LayersPanel";
import { InspectorPanel } from "./InspectorPanel";
import { Legend } from "./Legend";
import { MapChatBar } from "@/components/chat/MapChatBar";
import { BuildingMiniChat } from "@/components/chat/BuildingMiniChat";
import { buildPersonas } from "@/lib/sim/personas";
import { SCENARIOS } from "@/lib/sim/scenarios";
import { runScenario } from "@/lib/sim/engine";
import { useSimStore } from "@/store/useSimStore";
import { useMapStore } from "@/store/useMapStore";
import type {
  NeighbourhoodCollection,
  Persona,
  RouteCollection,
} from "@/lib/sim/types";

interface CityData {
  neighbourhoods: NeighbourhoodCollection;
  routes: RouteCollection;
  busRoutes: RouteCollection;
  personas: Persona[];
}

export function Dashboard() {
  const [data, setData] = useState<CityData | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const status = useSimStore((s) => s.status);
  const scenarioId = useSimStore((s) => s.scenarioId);
  const selectedCode = useSimStore((s) => s.selectedCode);
  const dataRef = useRef<CityData | null>(null);

  // Load the real geodata once, then synthesize the census-weighted population.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [nbhdRes, routeRes, busRouteRes] = await Promise.all([
          fetch("/data/neighbourhoods.geojson"),
          fetch("/data/ttc-routes.geojson"),
          fetch("/data/ttc-bus-routes.geojson"),
        ]);
        if (!nbhdRes.ok || !routeRes.ok || !busRouteRes.ok)
          throw new Error("geodata fetch failed");
        const neighbourhoods =
          (await nbhdRes.json()) as NeighbourhoodCollection;
        const routes = (await routeRes.json()) as RouteCollection;
        const busRoutes = (await busRouteRes.json()) as RouteCollection;
        if (cancelled) return;
        const personas = buildPersonas(neighbourhoods);
        const city = { neighbourhoods, routes, busRoutes, personas };
        dataRef.current = city;
        setData(city);
        useSimStore.getState().setPersonaCount(personas.length);
      } catch {
        if (!cancelled) useSimStore.getState().setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-run the preview engine whenever the scenario changes.
  useEffect(() => {
    const city = dataRef.current;
    if (!city) return;
    const result = runScenario(scenarioId, city.personas, city.routes);
    useSimStore.getState().setResult(result);
  }, [scenarioId, data]);

  useEffect(() => {
    if (mapReady && data) useSimStore.getState().setStatus("ready");
  }, [mapReady, data]);

  // Escape clears the selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        useSimStore.getState().select(null);
        useMapStore.getState().clearPlaceSelection();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const nbhdIndex = useMemo(
    () =>
      new Map(
        (data?.neighbourhoods.features ?? []).map((f) => [
          f.properties.code,
          f.properties,
        ])
      ),
    [data]
  );

  return (
    <div className="relative h-dvh w-screen overflow-hidden bg-ink text-ink-dim">
      {data && (
        <MapCanvas
          neighbourhoods={data.neighbourhoods}
          routes={data.routes}
          busRoutes={data.busRoutes}
          personas={data.personas}
          onReady={() => setMapReady(true)}
        />
      )}

      {/* Left rail: identity, scenario, layers */}
      <div className="pointer-events-none absolute left-4 top-4 z-10 hidden w-[288px] flex-col gap-3 md:flex">
        <Wordmark />
        <ScenarioPanel />
        <LayersPanel />
      </div>

      {/* Mobile: compact header + scenario chips */}
      <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex flex-col gap-2 md:hidden">
        <Wordmark />
        <div className="pointer-events-auto -mx-1 overflow-x-auto px-1 pb-1">
          <MobileScenarioChips />
        </div>
      </div>

      {/* Right: legend + neighbourhood inspector stacked */}
      <div className="pointer-events-none absolute right-4 top-4 z-10 hidden flex-col items-end gap-2.5 lg:flex">
        <Legend />
        {data && selectedCode && (
          <InspectorPanel index={nbhdIndex} personas={data.personas} />
        )}
      </div>

      <BuildingMiniChat />

      {/* Bottom: liquid-glass City Copilot */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center p-3 sm:p-4">
        <div className="pointer-events-auto w-full max-w-3xl px-1 md:px-0">
          <MapChatBar enablePlanningRun={false} />
        </div>
      </div>

      {status === "loading" && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-ink">
          <div className="text-center">
            <div className="font-ui text-[13px] font-semibold uppercase tracking-[0.3em] text-ink-bright">
              ToronTwin
            </div>
            <div className="mt-2 font-mono text-[11px] text-muted">
              loading Toronto geodata…
            </div>
          </div>
        </div>
      )}
      {status === "error" && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-ink">
          <div className="max-w-sm border border-hairline bg-panel px-6 py-5 text-center">
            <div className="text-[13px] font-semibold text-ink-bright">
              Couldn&apos;t load the city
            </div>
            <p className="mt-1.5 text-[12px] leading-snug text-muted">
              The neighbourhood or transit geodata failed to load. Check the
              connection and reload.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function Wordmark() {
  return (
    <header className="pointer-events-auto flex items-baseline gap-2.5 border border-hairline bg-panel px-4 py-2.5">
      <h1 className="font-ui text-[13px] font-bold uppercase tracking-[0.26em] text-ink-bright">
        ToronTwin
      </h1>
      <span className="font-mono text-[9.5px] uppercase tracking-wider text-muted">
        Toronto · synthetic population preview
      </span>
    </header>
  );
}

function MobileScenarioChips() {
  const scenarioId = useSimStore((s) => s.scenarioId);
  const setScenario = useSimStore((s) => s.setScenario);
  return (
    <div className="flex gap-1.5">
      {SCENARIOS.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => setScenario(s.id)}
          className={
            s.id === scenarioId
              ? "whitespace-nowrap border border-white/25 bg-white/10 px-3 py-1.5 text-[11px] text-ink-bright"
              : "whitespace-nowrap border border-hairline bg-panel px-3 py-1.5 text-[11px] text-muted"
          }
        >
          {s.name}
        </button>
      ))}
    </div>
  );
}
