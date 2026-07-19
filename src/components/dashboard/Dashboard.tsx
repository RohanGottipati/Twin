"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MapCanvas } from "./MapCanvas";
import { LayersPanel } from "./LayersPanel";
import { InspectorPanel } from "./InspectorPanel";
import { MapChatBar } from "@/components/chat/MapChatBar";
import { BuildingMiniChat } from "@/components/chat/BuildingMiniChat";
import { CityPlanStrip, useCityPlanRun } from "@/components/planner/CityPlanStrip";
import { buildPersonas } from "@/lib/sim/personas";
import { runScenario } from "@/lib/sim/engine";
import { useSimStore } from "@/store/useSimStore";
import { useMapStore } from "@/store/useMapStore";
import type {
  NeighbourhoodCollection,
  Persona,
  RouteCollection,
} from "@/lib/sim/types";
import { CANNED_CITY_ASKS } from "@/lib/planner/canned";

interface CityData {
  neighbourhoods: NeighbourhoodCollection;
  routes: RouteCollection;
  busRoutes: RouteCollection;
  personas: Persona[];
}

/**
 * Loads real residents from `/api/personas` (backed by MongoDB's
 * `resident_personas`). Falls back to fully-synthetic `buildPersonas()`
 * only if the API is unreachable, so the map still renders during an
 * outage -- this fallback path is not the intended steady state.
 */
async function loadPersonas(neighbourhoods: NeighbourhoodCollection): Promise<Persona[]> {
  try {
    const response = await fetch("/api/personas");
    if (!response.ok) throw new Error("personas fetch failed");
    const data = (await response.json()) as { personas: Persona[] };
    if (data.personas?.length) return data.personas;
    throw new Error("personas response empty");
  } catch {
    return buildPersonas(neighbourhoods);
  }
}

export function Dashboard() {
  const [data, setData] = useState<CityData | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const status = useSimStore((s) => s.status);
  const scenarioId = useSimStore((s) => s.scenarioId);
  const selectedCode = useSimStore((s) => s.selectedCode);
  const selectedPlace = useMapStore((s) => s.selectedPlace);
  const placeChatOpen = useMapStore((s) => s.buildingMiniChatOpen);
  const dataRef = useRef<CityData | null>(null);
  const cityPlan = useCityPlanRun();

  // Load the real geodata once, then load the real resident population.
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
        const personas = await loadPersonas(neighbourhoods);
        if (cancelled) return;
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
        useMapStore.getState().clearAgent3DFocus();
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

      {/* Left rail: identity and map layers */}
      <div className="pointer-events-none absolute left-4 top-4 z-10 hidden w-[288px] flex-col gap-3 md:flex">
        <Wordmark />
        <LayersPanel />
      </div>

      {/* Mobile: compact identity header */}
      <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex flex-col gap-2 md:hidden">
        <Wordmark />
      </div>

      {/* Right rail: selected-place information, then its local chat. */}
      {data && (selectedCode || (selectedPlace && placeChatOpen)) && (
        <div className="pointer-events-none absolute right-4 top-4 z-30 flex max-h-[calc(100dvh-7rem)] flex-col gap-3">
          {selectedCode && (
            <InspectorPanel index={nbhdIndex} personas={data.personas} />
          )}
          <BuildingMiniChat placement="below-inspector" />
        </div>
      )}

      {/* Demo canned asks + live plan strip */}
      <div className="pointer-events-none absolute inset-x-0 bottom-[4.5rem] z-20 flex flex-col items-center gap-2 px-3 sm:px-4 md:bottom-24">
        <div className="pointer-events-auto flex max-w-3xl flex-wrap justify-center gap-1.5">
          {CANNED_CITY_ASKS.map((ask) => (
            <button
              key={ask.id}
              type="button"
              disabled={cityPlan.isRunning}
              onClick={() => void cityPlan.start(ask.question)}
              className="border border-hairline bg-panel/90 px-2.5 py-1 text-[10px] text-muted backdrop-blur hover:text-ink-bright disabled:opacity-50"
              title={ask.question}
            >
              {ask.id}
            </button>
          ))}
        </div>
        <CityPlanStrip
          summary={cityPlan.summary}
          isRunning={cityPlan.isRunning}
          liveText={cityPlan.liveText}
        />
      </div>

      {/* Bottom: liquid-glass City Copilot */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center p-3 sm:p-4">
        <div className="pointer-events-auto w-full max-w-3xl px-1 md:px-0">
          <MapChatBar
            enablePlanningRun={false}
            enableCityPlanRun
            cityPlanRunning={cityPlan.isRunning}
            onCityPlanQuestion={async (q, handlers, options) => {
              const payload = await cityPlan.start(q, handlers, options);
              return payload;
            }}
          />
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
        Toronto · Backboard planning dept · synthetic citizens
      </span>
    </header>
  );
}
