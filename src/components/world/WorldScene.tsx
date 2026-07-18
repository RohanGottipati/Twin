"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Cartesian2 as Cartesian2Type,
  ScreenSpaceEventHandler as ScreenSpaceEventHandlerType,
} from "cesium";
import { getCityById, getEnabledCities } from "@/config/cities/registry";
import { hasCesiumToken, CESIUM_ION_TOKEN } from "@/env";
import {
  useWorldStore,
  type WorldMode,
} from "@/store/useWorldStore";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import {
  initializeViewer,
  isWebGLAvailable,
} from "@/lib/cesium/initializeViewer";
import {
  createCityMarkers,
  getCityIdFromEntity,
  isCityMarkerEntity,
  setMarkerLabelsVisible,
  setMarkersVisible,
} from "@/lib/cesium/createCityMarkers";
import {
  createBuildingLayer,
  setBuildingsVisible,
} from "@/lib/cesium/createBuildingLayer";
import {
  flyToCity,
  flyToCityClose,
  flyToCityOverview,
  flyToWorld,
  resetNorth as resetNorthCamera,
  resetCurrentView,
  setWorldView,
  WORLD_CAMERA,
  zoomIn as zoomInCamera,
  zoomOut as zoomOutCamera,
} from "@/lib/cesium/camera";
import {
  attachBuildingSelection,
  restoreSelectedFeatureColor,
} from "@/lib/cesium/selection";
import { cleanupScene } from "@/lib/cesium/cleanup";
import { createSceneRefs, type CesiumModule } from "@/lib/cesium/types";
import { WorldAppShell } from "./WorldAppShell";
import {
  SceneControllerContext,
  type SceneController,
} from "./SceneControllerContext";

const AUTO_ROTATE_RATE_DEGREES = 0.015;

export default function WorldScene() {
  const containerRef = useRef<HTMLDivElement>(null);
  const cesiumRef = useRef<CesiumModule | null>(null);
  const refs = useRef(createSceneRefs());
  const autoRotateSuspendedRef = useRef(false);
  const lastCameraUpdateRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const markerHandlerRef = useRef<ScreenSpaceEventHandlerType | null>(null);
  const tickListenerRef = useRef<(() => void) | null>(null);
  const suspendListenersRef = useRef<{
    canvas: HTMLCanvasElement;
    suspend: () => void;
  } | null>(null);
  const reducedMotion = useReducedMotion();
  const reducedMotionRef = useRef(reducedMotion);
  const [initKey, setInitKey] = useState(0);

  const store = useWorldStore;

  const mode = useWorldStore((s) => s.mode);
  const buildingsEnabled = useWorldStore((s) => s.buildingsEnabled);
  const terrainEnabled = useWorldStore((s) => s.terrainEnabled);
  const cityMarkersEnabled = useWorldStore((s) => s.cityMarkersEnabled);
  const labelsEnabled = useWorldStore((s) => s.labelsEnabled);
  const atmosphereEnabled = useWorldStore((s) => s.atmosphereEnabled);
  const lightingEnabled = useWorldStore((s) => s.lightingEnabled);
  const globeRotationEnabled = useWorldStore((s) => s.globeRotationEnabled);
  const selectedBuilding = useWorldStore((s) => s.selectedBuilding);

  useEffect(() => {
    reducedMotionRef.current = reducedMotion;
  }, [reducedMotion]);

  const throttledCameraUpdate = useCallback(() => {
    const now = Date.now();
    if (now - lastCameraUpdateRef.current < 180) {
      return;
    }
    lastCameraUpdateRef.current = now;
    if (rafRef.current !== null) {
      return;
    }
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const Cesium = cesiumRef.current;
      const viewer = refs.current.viewer;
      if (!Cesium || !viewer || viewer.isDestroyed()) {
        return;
      }
      const carto = viewer.camera.positionCartographic;
      store.getState().updateCameraPosition({
        height: carto.height,
        longitude: Cesium.Math.toDegrees(carto.longitude),
        latitude: Cesium.Math.toDegrees(carto.latitude),
      });
    });
  }, [store]);

  // Main scene initialization (runs once per initKey).
  useEffect(() => {
    let cancelled = false;
    const localRefs = refs.current;

    async function init() {
      const state = store.getState();

      if (!isWebGLAvailable()) {
        state.setSceneError({
          title: "WebGL is not available",
          message:
            "Skyline requires WebGL to display the 3D world. Enable hardware acceleration or try a different browser.",
          critical: true,
        });
        state.setSceneLoading(false);
        return;
      }

      if (!hasCesiumToken()) {
        state.setSceneError({
          title: "Cesium ion token missing",
          message:
            "A Cesium ion access token is required to load the 3D world.",
          critical: true,
        });
        state.setSceneLoading(false);
        return;
      }

      const container = containerRef.current;
      if (!container) {
        return;
      }

      state.setSceneError(null);
      state.setSceneLoading(true);
      state.setLoadingStage("engine");

      // Assign the Cesium base URL before importing Cesium runtime values.
      window.CESIUM_BASE_URL = "/cesium/";
      const Cesium = (await import("cesium")) as CesiumModule;
      if (cancelled) {
        return;
      }
      cesiumRef.current = Cesium;

      try {
        state.setLoadingStage("terrain");
        const viewer = initializeViewer({
          Cesium,
          container,
          token: CESIUM_ION_TOKEN,
        });
        localRefs.viewer = viewer;

        // Initial world camera without a flight animation.
        setWorldView(Cesium, viewer);
        const carto = viewer.camera.positionCartographic;
        state.updateCameraPosition({
          height: carto.height,
          longitude: Cesium.Math.toDegrees(carto.longitude),
          latitude: Cesium.Math.toDegrees(carto.latitude),
        });

        // City markers.
        state.setLoadingStage("markers");
        localRefs.markerEntities = createCityMarkers({
          Cesium,
          viewer,
          cities: getEnabledCities(),
        });

        // Building selection handler.
        attachBuildingSelection(
          Cesium,
          viewer,
          localRefs,
          {
            onSelect: (building) =>
              store.getState().setSelectedBuilding(building),
            onClear: () => store.getState().clearSelectedBuilding(),
          },
          () => {
            const s = store.getState();
            return s.mode !== "world" && s.buildingsEnabled;
          }
        );

        // Marker picking (left click on a city marker opens preview).
        const markerHandler = new Cesium.ScreenSpaceEventHandler(
          viewer.scene.canvas
        );
        markerHandler.setInputAction(
          (movement: { position: Cartesian2Type }) => {
            const picked = viewer.scene.pick(movement.position);
            if (
              Cesium.defined(picked) &&
              picked.id &&
              picked.id.entity &&
              isCityMarkerEntity(picked.id.entity)
            ) {
              const cityId = getCityIdFromEntity(picked.id.entity);
              if (cityId && store.getState().mode === "world") {
                autoRotateSuspendedRef.current = true;
                store.getState().setPreviewCity(cityId);
              }
            }
          },
          Cesium.ScreenSpaceEventType.LEFT_CLICK
        );
        markerHandlerRef.current = markerHandler;

        // Camera position updates (throttled).
        viewer.camera.percentageChanged = 0.02;
        viewer.camera.changed.addEventListener(throttledCameraUpdate);
        viewer.camera.moveEnd.addEventListener(throttledCameraUpdate);

        // Suspend auto-rotation on any user interaction.
        const suspend = () => {
          autoRotateSuspendedRef.current = true;
        };
        const canvas = viewer.scene.canvas;
        canvas.addEventListener("pointerdown", suspend);
        canvas.addEventListener("wheel", suspend, { passive: true });
        canvas.addEventListener("touchstart", suspend, { passive: true });
        suspendListenersRef.current = { canvas, suspend };

        // Auto-rotation tick.
        const onTick = () => {
          const s = store.getState();
          if (
            !s.globeRotationEnabled ||
            s.mode !== "world" ||
            s.isFlying ||
            reducedMotionRef.current ||
            autoRotateSuspendedRef.current ||
            (typeof document !== "undefined" && document.hidden)
          ) {
            return;
          }
          viewer.camera.rotate(
            Cesium.Cartesian3.UNIT_Z,
            -Cesium.Math.toRadians(AUTO_ROTATE_RATE_DEGREES)
          );
        };
        viewer.clock.onTick.addEventListener(onTick);
        tickListenerRef.current = onTick;

        // Scene is considered ready now; buildings continue loading.
        state.setSceneReady(true);
        state.setLoadingStage("buildings");
        state.setSceneLoading(false);

        // OSM buildings (non-fatal on failure).
        try {
          const tileset = await createBuildingLayer({ Cesium, viewer });
          if (!cancelled) {
            localRefs.buildingTileset = tileset;
            const s = store.getState();
            setBuildingsVisible(
              tileset,
              s.mode !== "world" && s.buildingsEnabled
            );
          }
        } catch {
          if (!cancelled) {
            store.getState().setSceneError({
              title: "3D buildings unavailable",
              message:
                "The OpenStreetMap 3D buildings layer failed to load. The globe remains usable.",
              critical: false,
            });
          }
        } finally {
          if (!cancelled) {
            store.getState().setLoadingStage("ready");
          }
        }
      } catch (error) {
        if (!cancelled) {
          const message =
            error instanceof Error ? error.message : String(error);
          store.getState().setSceneError({
            title: "Unable to initialize the 3D scene",
            message,
            critical: true,
          });
          store.getState().setSceneLoading(false);
        }
      }
    }

    init();

    return () => {
      cancelled = true;
      const Cesium = cesiumRef.current;
      const viewer = localRefs.viewer;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (viewer && !viewer.isDestroyed()) {
        try {
          viewer.camera.changed.removeEventListener(throttledCameraUpdate);
          viewer.camera.moveEnd.removeEventListener(throttledCameraUpdate);
        } catch {
          // ignore
        }
        if (tickListenerRef.current) {
          try {
            viewer.clock.onTick.removeEventListener(tickListenerRef.current);
          } catch {
            // ignore
          }
          tickListenerRef.current = null;
        }
      }
      if (suspendListenersRef.current) {
        const { canvas, suspend } = suspendListenersRef.current;
        canvas.removeEventListener("pointerdown", suspend);
        canvas.removeEventListener("wheel", suspend);
        canvas.removeEventListener("touchstart", suspend);
        suspendListenersRef.current = null;
      }
      if (markerHandlerRef.current) {
        try {
          if (!markerHandlerRef.current.isDestroyed()) {
            markerHandlerRef.current.destroy();
          }
        } catch {
          // ignore
        }
        markerHandlerRef.current = null;
      }
      if (Cesium) {
        cleanupScene(Cesium, localRefs);
      }
      const s = store.getState();
      s.setSceneReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initKey]);

  // React to layer / mode changes.
  useEffect(() => {
    const tileset = refs.current.buildingTileset;
    setBuildingsVisible(tileset, mode !== "world" && buildingsEnabled);
  }, [mode, buildingsEnabled]);

  useEffect(() => {
    setMarkersVisible(
      refs.current.markerEntities,
      mode === "world" && cityMarkersEnabled
    );
  }, [mode, cityMarkersEnabled]);

  useEffect(() => {
    const Cesium = cesiumRef.current;
    if (!Cesium) {
      return;
    }
    setMarkerLabelsVisible(
      Cesium,
      refs.current.markerEntities,
      labelsEnabled
    );
  }, [labelsEnabled]);

  useEffect(() => {
    const viewer = refs.current.viewer;
    if (!viewer || viewer.isDestroyed()) {
      return;
    }
    viewer.scene.skyAtmosphere.show = atmosphereEnabled;
    viewer.scene.globe.showGroundAtmosphere = atmosphereEnabled;
    viewer.scene.fog.enabled = atmosphereEnabled;
  }, [atmosphereEnabled]);

  useEffect(() => {
    const viewer = refs.current.viewer;
    if (!viewer || viewer.isDestroyed()) {
      return;
    }
    viewer.scene.globe.enableLighting = lightingEnabled;
  }, [lightingEnabled]);

  useEffect(() => {
    if (globeRotationEnabled) {
      autoRotateSuspendedRef.current = false;
    }
  }, [globeRotationEnabled]);

  // Restore the highlighted feature color whenever selection is cleared.
  useEffect(() => {
    const Cesium = cesiumRef.current;
    if (!selectedBuilding && Cesium && refs.current.selectedFeature) {
      restoreSelectedFeatureColor(Cesium, refs.current);
    }
  }, [selectedBuilding]);

  // Terrain toggle (world terrain vs ellipsoid fallback).
  useEffect(() => {
    const Cesium = cesiumRef.current;
    const viewer = refs.current.viewer;
    if (!Cesium || !viewer || viewer.isDestroyed()) {
      return;
    }
    let active = true;
    async function applyTerrain() {
      const state = store.getState();
      state.setSceneLoading(true);
      try {
        if (terrainEnabled) {
          const terrainProvider =
            await Cesium!.createWorldTerrainAsync();
          if (active && viewer && !viewer.isDestroyed()) {
            viewer.terrainProvider = terrainProvider;
          }
        } else if (active && viewer && !viewer.isDestroyed()) {
          viewer.terrainProvider = new Cesium!.EllipsoidTerrainProvider();
        }
      } catch {
        // Keep the current terrain provider on failure.
      } finally {
        if (active) {
          store.getState().setSceneLoading(false);
        }
      }
    }
    applyTerrain();
    return () => {
      active = false;
    };
  }, [terrainEnabled, store]);

  // Document visibility: nothing extra needed; tick checks document.hidden.

  const controller = useMemo<SceneController>(() => {
    const getCtx = () => {
      const Cesium = cesiumRef.current;
      const viewer = refs.current.viewer;
      if (!Cesium || !viewer || viewer.isDestroyed()) {
        return null;
      }
      return { Cesium, viewer };
    };

    const setFlyingWithCity = (nextMode: WorldMode) => {
      store.getState().setMode(nextMode);
    };

    return {
      goToWorld: () => {
        const ctx = getCtx();
        const s = store.getState();
        if (refs.current.selectedFeature && cesiumRef.current) {
          restoreSelectedFeatureColor(cesiumRef.current, refs.current);
        }
        s.clearSelectedBuilding();
        s.setPreviewCity(null);
        s.setMode("world");
        setBuildingsVisible(refs.current.buildingTileset, false);
        setMarkersVisible(
          refs.current.markerEntities,
          store.getState().cityMarkersEnabled
        );
        if (!ctx) {
          return;
        }
        s.setFlying(true);
        flyToWorld(ctx.Cesium, ctx.viewer, reducedMotionRef.current, {
          onComplete: () => {
            store.getState().setFlying(false);
            autoRotateSuspendedRef.current = false;
          },
          onCancel: () => store.getState().setFlying(false),
        });
      },

      previewCity: (cityId: string) => {
        autoRotateSuspendedRef.current = true;
        store.getState().setPreviewCity(cityId);
      },

      exploreCity: (cityId: string) => {
        const ctx = getCtx();
        const city = getCityById(cityId);
        const s = store.getState();
        if (!city) {
          return;
        }
        s.setActiveCity(cityId);
        s.setPreviewCity(null);
        s.setMode("city-overview");
        setBuildingsVisible(
          refs.current.buildingTileset,
          s.buildingsEnabled
        );
        setMarkersVisible(refs.current.markerEntities, false);
        if (!ctx) {
          return;
        }
        s.setFlying(true);
        flyToCityOverview(
          ctx.Cesium,
          ctx.viewer,
          city,
          reducedMotionRef.current,
          {
            onComplete: () => store.getState().setFlying(false),
            onCancel: () => store.getState().setFlying(false),
          }
        );
      },

      goToCityOverview: () => {
        const ctx = getCtx();
        const s = store.getState();
        if (s.isFlying) {
          return;
        }
        const cityId = s.activeCityId ?? "toronto";
        const city = getCityById(cityId);
        if (!city || !ctx) {
          return;
        }
        s.setActiveCity(cityId);
        setFlyingWithCity("city-overview");
        setBuildingsVisible(
          refs.current.buildingTileset,
          store.getState().buildingsEnabled
        );
        setMarkersVisible(refs.current.markerEntities, false);
        s.setFlying(true);
        flyToCityOverview(
          ctx.Cesium,
          ctx.viewer,
          city,
          reducedMotionRef.current,
          {
            onComplete: () => store.getState().setFlying(false),
            onCancel: () => store.getState().setFlying(false),
          }
        );
      },

      goToCity: () => {
        const ctx = getCtx();
        const s = store.getState();
        if (s.isFlying) {
          return;
        }
        const cityId = s.activeCityId ?? "toronto";
        const city = getCityById(cityId);
        if (!city || !ctx) {
          return;
        }
        s.setActiveCity(cityId);
        setFlyingWithCity("city");
        setBuildingsVisible(
          refs.current.buildingTileset,
          store.getState().buildingsEnabled
        );
        setMarkersVisible(refs.current.markerEntities, false);
        s.setFlying(true);
        flyToCity(ctx.Cesium, ctx.viewer, city, reducedMotionRef.current, {
          onComplete: () => store.getState().setFlying(false),
          onCancel: () => store.getState().setFlying(false),
        });
      },

      goToCityClose: () => {
        const ctx = getCtx();
        const s = store.getState();
        if (s.isFlying) {
          return;
        }
        const cityId = s.activeCityId ?? "toronto";
        const city = getCityById(cityId);
        if (!city || !ctx) {
          return;
        }
        s.setActiveCity(cityId);
        setFlyingWithCity("city-close");
        setBuildingsVisible(
          refs.current.buildingTileset,
          store.getState().buildingsEnabled
        );
        setMarkersVisible(refs.current.markerEntities, false);
        s.setFlying(true);
        flyToCityClose(
          ctx.Cesium,
          ctx.viewer,
          city,
          reducedMotionRef.current,
          {
            onComplete: () => store.getState().setFlying(false),
            onCancel: () => store.getState().setFlying(false),
          }
        );
      },

      zoomIn: () => {
        const ctx = getCtx();
        if (ctx) {
          zoomInCamera(ctx.viewer);
        }
      },

      zoomOut: () => {
        const ctx = getCtx();
        if (ctx) {
          zoomOutCamera(ctx.viewer);
        }
      },

      resetView: () => {
        const ctx = getCtx();
        const s = store.getState();
        if (!ctx) {
          return;
        }
        if (s.mode === "world") {
          s.setFlying(true);
          flyToWorld(ctx.Cesium, ctx.viewer, reducedMotionRef.current, {
            onComplete: () => store.getState().setFlying(false),
            onCancel: () => store.getState().setFlying(false),
          });
          return;
        }
        const city = getCityById(s.activeCityId ?? "toronto");
        if (!city) {
          return;
        }
        const preset =
          s.mode === "city-overview"
            ? city.cameras.overview
            : s.mode === "city"
              ? city.cameras.city
              : city.cameras.close;
        s.setFlying(true);
        resetCurrentView(
          ctx.Cesium,
          ctx.viewer,
          preset,
          reducedMotionRef.current,
          {
            onComplete: () => store.getState().setFlying(false),
            onCancel: () => store.getState().setFlying(false),
          }
        );
      },

      resetNorth: () => {
        const ctx = getCtx();
        if (ctx) {
          resetNorthCamera(ctx.Cesium, ctx.viewer, reducedMotionRef.current);
        }
      },

      toggleFullscreen: () => {
        try {
          if (document.fullscreenElement) {
            document.exitFullscreen();
          } else {
            document.documentElement.requestFullscreen();
          }
        } catch {
          store.getState().setSceneError({
            title: "Fullscreen unavailable",
            message: "This browser blocked the fullscreen request.",
            critical: false,
          });
        }
      },

      retry: () => {
        store.getState().setSceneError(null);
        store.getState().setSceneReady(false);
        store.getState().setSceneLoading(true);
        store.getState().setLoadingStage("engine");
        setInitKey((key) => key + 1);
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  // Keep the world camera preset available to satisfy references.
  void WORLD_CAMERA;

  return (
    <SceneControllerContext.Provider value={controller}>
      <div
        className="relative h-full w-full"
        data-testid="world-app"
      >
        <div
          ref={containerRef}
          className="absolute inset-0 h-full w-full"
          aria-hidden="true"
        />
        <WorldAppShell />
      </div>
    </SceneControllerContext.Provider>
  );
}
