"use client";

import type { LoadingStage } from "@/store/useWorldStore";

const STAGE_LABEL: Record<LoadingStage, string> = {
  engine: "Preparing 3D engine",
  terrain: "Loading world terrain",
  buildings: "Loading city buildings",
  markers: "Creating city markers",
  ready: "Ready",
};

const STAGE_ORDER: LoadingStage[] = [
  "engine",
  "terrain",
  "buildings",
  "markers",
  "ready",
];

type SceneLoadingScreenProps = {
  stage?: LoadingStage;
};

export function SceneLoadingScreen({
  stage = "engine",
}: SceneLoadingScreenProps) {
  const activeIndex = STAGE_ORDER.indexOf(stage);

  return (
    <div
      className="absolute inset-0 z-[60] flex flex-col items-center justify-center bg-[#070A0F]"
      role="status"
      aria-live="polite"
      data-testid="scene-loading"
    >
      <div className="relative h-24 w-24">
        <div className="absolute inset-0 rounded-full border border-white/10" />
        <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-[#55D8E6] border-r-[#6287FF]" />
        <div className="absolute inset-3 rounded-full bg-[#55D8E6]/10" />
      </div>

      <p className="mt-8 text-lg font-semibold tracking-wide text-[#F5F7FA]">
        Skyline
      </p>
      <p className="mt-1 text-sm text-[#9AA7B5]">{STAGE_LABEL[stage]}</p>

      <div className="mt-6 flex items-center gap-2">
        {STAGE_ORDER.map((item, index) => (
          <span
            key={item}
            className={
              "h-1.5 w-6 rounded-full transition-colors " +
              (index <= activeIndex ? "bg-[#55D8E6]" : "bg-white/10")
            }
          />
        ))}
      </div>
    </div>
  );
}
