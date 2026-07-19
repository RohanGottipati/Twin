"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MapCanvas } from "./MapCanvas";
import { LayersPanel } from "./LayersPanel";
import { ScenarioPanel } from "./ScenarioPanel";
import { InspectorPanel } from "./InspectorPanel";
import { MapChatBar } from "@/components/chat/MapChatBar";
import { BuildingMiniChat } from "@/components/chat/BuildingMiniChat";
import { useCityPlanRun } from "@/components/planner/CityPlanStrip";
import { buildPersonas } from "@/lib/sim/personas";
import { runScenario, aggregate } from "@/lib/sim/engine";
import type { HomeSitesByCode } from "@/lib/sim/home-sites";
import { sampleHomeSite } from "@/lib/sim/home-sites";
import { hashString, mulberry32 } from "@/lib/random";
import { useSimStore } from "@/store/useSimStore";
import { useMapStore } from "@/store/useMapStore";
import type {
  NeighbourhoodCollection,
  Persona,
  RouteCollection,
} from "@/lib/sim/types";

/**
 * Streams real per-resident acceptance (src/app/api/neighbourhood-acceptance/route.ts,
 * Monte-Carlo-sampled from real resident_personas against the real trained
 * opinion model). Each event is exactly one resident who was actually
 * sampled and scored -- we only ever light up that one dot, never every
 * resident sharing its neighbourhood, so the map honestly reflects "these
 * few people were asked" rather than implying the whole population was.
 */
async function streamRealAcceptance(
  scenarioId: string,
  personaIndexById: Map<string, number>,
  acceptance: Float32Array,
  opinions: Map<number, string>,
  onSample: (acceptance: Float32Array, opinions: Map<number, string>) => void,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(`/api/neighbourhood-acceptance?scenarioId=${encodeURIComponent(scenarioId)}`, {
    signal,
  });
  if (!response.ok || !response.body) return;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";

    for (const block of blocks) {
      const dataLine = block.split("\n").find((line) => line.startsWith("data:"));
      if (!dataLine) continue;
      let parsed: { personaId?: string; acceptance?: number; opinionText?: string; done?: boolean };
      try {
        parsed = JSON.parse(dataLine.slice("data:".length).trim());
      } catch {
        continue;
      }
      if (parsed.done) return;
      if (parsed.personaId && typeof parsed.acceptance === "number") {
        const index = personaIndexById.get(parsed.personaId);
        if (index !== undefined) {
          acceptance[index] = parsed.acceptance;
          if (parsed.opinionText) opinions.set(index, parsed.opinionText);
          onSample(acceptance, opinions);
        }
      }
    }
  }
}

interface CityData {
  neighbourhoods: NeighbourhoodCollection;
  routes: RouteCollection;
  busRoutes: RouteCollection;
  personas: Persona[];
}

/** Zoning-filtered residential building centroids (public/data/home-sites.json). */
async function loadHomeSites(): Promise<HomeSitesByCode | null> {
  const response = await fetch("/data/home-sites.json");
  if (!response.ok) return null;
  return (await response.json()) as HomeSitesByCode;
}

/**
 * Loads real residents from `/api/personas` (backed by MongoDB's
 * `resident_personas`), placed on residential-zone building centroids.
 * Falls back to synthetic `buildPersonas()` (also building-snapped when
 * home-sites.json is available) if the API is unreachable.
 */
async function loadPersonas(neighbourhoods: NeighbourhoodCollection): Promise<Persona[]> {
  try {
    const response = await fetch("/api/personas");
    if (!response.ok) throw new Error("personas fetch failed");
    const data = (await response.json()) as {
      personas: Persona[];
      placement?: string;
    };
    if (data.personas?.length) {
      // if API fell back to polygon scatter, re-snap client-side when we can
      if (data.placement === "neighbourhood-polygon") {
        const homes = await loadHomeSites();
        if (homes) {
          // rebuild coords from homes while keeping persona attrs from API
          for (const p of data.personas) {
            const rng = mulberry32(hashString(`resnap:${p.code}:${p.id}`));
            const spot = sampleHomeSite(homes, p.code, rng);
            if (spot) {
              p.lng = spot[0];
              p.lat = spot[1];
            }
          }
        }
      }
      return data.personas;
    }
    throw new Error("personas response empty");
  } catch {
    const homes = await loadHomeSites();
    return buildPersonas(neighbourhoods, homes);
  }
}

export function Dashboard() {
  const [data, setData] = useState<CityData | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const status = useSimStore((s) => s.status);
  const scenarioId = useSimStore((s) => s.scenarioId);
  const acceptanceLoading = useSimStore((s) => s.acceptanceLoading);
  const selectedCode = useSimStore((s) => s.selectedCode);
  const selectedPlace = useMapStore((s) => s.selectedPlace);
  const placeChatOpen = useMapStore((s) => s.buildingMiniChatOpen);
  const dataRef = useRef<CityData | null>(null);
  const cityPlan = useCityPlanRun();
  const acceptanceRef = useRef<Float32Array | null>(null);
  const opinionsRef = useRef<Map<number, string>>(new Map());
  const sweepKmRef = useRef<Float32Array | null>(null);

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

  const personaIndexById = useMemo(() => {
    const index = new Map<string, number>();
    (data?.personas ?? []).forEach((p, i) => {
      if (p.personaId) index.set(p.personaId, i);
    });
    return index;
  }, [data]);

  // Whenever the scenario changes to an actual proposed intervention (never
  // on initial load, where scenarioId is still "baseline" and there's
  // nothing yet to react to): get sweepKm (positional only, for the reveal
  // animation) from the local engine, show neutral dots immediately (never
  // the fake formula's acceptance -- see engine.ts's own header), then
  // stream in real Monte-Carlo-sampled acceptance resident by resident as it
  // arrives -- only the residents actually sampled get lit.
  useEffect(() => {
    const city = dataRef.current;
    if (!city) return;

    const { sweepKm } = runScenario(scenarioId, city.personas, city.routes);
    const acceptance = new Float32Array(city.personas.length).fill(0.5);
    const opinions = new Map<number, string>();
    acceptanceRef.current = acceptance;
    opinionsRef.current = opinions;
    sweepKmRef.current = sweepKm;
    useSimStore.getState().setResult(aggregate(scenarioId, city.personas, acceptance, sweepKm));

    if (scenarioId === "baseline") return;

    const controller = new AbortController();
    useSimStore.getState().setAcceptanceLoading(true);

    streamRealAcceptance(
      scenarioId,
      personaIndexById,
      acceptance,
      opinions,
      (updated, updatedOpinions) => {
        if (controller.signal.aborted) return;
        const result = aggregate(scenarioId, city.personas, updated, sweepKm);
        result.opinions = updatedOpinions;
        useSimStore.getState().setResult(result);
      },
      controller.signal,
    )
      .catch(() => {
        // Aborted (scenario changed again) or the request failed; whatever streamed in stays, no fake fallback.
      })
      .finally(() => {
        if (!controller.signal.aborted) useSimStore.getState().setAcceptanceLoading(false);
      });

    return () => controller.abort();
  }, [scenarioId, data, personaIndexById]);

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

      {/* Top center: scenario tabs -- switch which version of the city is shown */}
      <div className="pointer-events-none absolute inset-x-0 top-4 z-10 hidden justify-center overflow-x-auto px-3 md:flex">
        <ScenarioPanel />
      </div>

      {/* Left rail: identity and map layers */}
      <div className="pointer-events-none absolute left-4 top-4 z-10 hidden w-[288px] flex-col gap-3 md:flex">
        <Wordmark />
        {acceptanceLoading && (
          <div className="border border-hairline bg-panel px-3 py-2 font-mono text-[10px] text-muted">
            Computing real citizen reactions from resident opinions…
          </div>
        )}
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

      {/* Bottom: liquid-glass City Copilot */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center p-3 sm:p-4">
        <div className="pointer-events-auto w-full max-w-3xl px-1 md:px-0">
          <MapChatBar
            enablePlanningRun={false}
            enableCityPlanRun
            cityPlanRunning={cityPlan.isRunning}
            onCityPlanQuestion={async (q, handlers) => {
              const payload = await cityPlan.start(q, {
                ...handlers,
                onPersonaScored: (result) => {
                  handlers.onPersonaScored?.(result);
                  const city = dataRef.current;
                  const acceptance = acceptanceRef.current;
                  const sweepKm = sweepKmRef.current;
                  if (!city || !acceptance || !sweepKm) return;
                  const index = personaIndexById.get(result.personaId);
                  if (index === undefined) return;
                  acceptance[index] = result.acceptance;
                  if (result.opinionText) opinionsRef.current.set(index, result.opinionText);
                  const merged = aggregate(scenarioId, city.personas, acceptance, sweepKm);
                  merged.opinions = opinionsRef.current;
                  useSimStore.getState().setResult(merged);
                },
              });
              return payload;
            }}
          />
        </div>
      </div>

      {status === "loading" && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-ink">
          <div className="text-center">
            <div className="font-ui text-[13px] font-semibold uppercase tracking-[0.3em] text-ink-bright">
              TechTO
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
        TechTO
      </h1>
    </header>
  );
}
