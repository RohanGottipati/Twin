"use client";

import dynamic from "next/dynamic";
import type { TorontoMapProps } from "@/components/map/TorontoMap";

/**
 * MapLibre touches `window`/WebGL at construction time, so the real map is
 * dynamically imported with `ssr: false` and never evaluated on the server,
 * the same isolation pattern the old Cesium scene used.
 */
const TorontoMap = dynamic(() => import("@/components/map/TorontoMap").then((mod) => mod.TorontoMap), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-twinto-ink">
      <p className="text-sm text-twinto-muted">Loading Toronto map…</p>
    </div>
  ),
});

export function TorontoMapClient(props: TorontoMapProps) {
  return <TorontoMap {...props} />;
}
