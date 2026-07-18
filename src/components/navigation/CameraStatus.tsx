"use client";

import { useWorldStore, type WorldMode } from "@/store/useWorldStore";
import { GlassPanel } from "@/components/primitives/GlassPanel";
import {
  formatCameraHeight,
  formatCoordinate,
} from "@/lib/utils/format";
import { useIsMobile } from "@/hooks/useMediaQuery";

const MODE_LABEL: Record<WorldMode, string> = {
  world: "World",
  "city-overview": "City overview",
  city: "City",
  "city-close": "City close",
};

export function CameraStatus() {
  const mode = useWorldStore((s) => s.mode);
  const height = useWorldStore((s) => s.cameraHeight);
  const longitude = useWorldStore((s) => s.cameraLongitude);
  const latitude = useWorldStore((s) => s.cameraLatitude);
  const isMobile = useIsMobile();

  if (isMobile) {
    return null;
  }

  return (
    <GlassPanel className="pointer-events-auto px-4 py-2">
      <dl className="flex items-center gap-4 text-xs">
        <div>
          <dt className="text-[#9AA7B5]">Mode</dt>
          <dd className="font-medium text-[#F5F7FA]">{MODE_LABEL[mode]}</dd>
        </div>
        <div className="h-6 w-px bg-white/10" />
        <div>
          <dt className="text-[#9AA7B5]">Altitude</dt>
          <dd className="font-medium text-[#F5F7FA]">
            {formatCameraHeight(height)}
          </dd>
        </div>
        <div>
          <dt className="text-[#9AA7B5]">Lat</dt>
          <dd className="font-medium text-[#F5F7FA]">
            {formatCoordinate(latitude)}
          </dd>
        </div>
        <div>
          <dt className="text-[#9AA7B5]">Lon</dt>
          <dd className="font-medium text-[#F5F7FA]">
            {formatCoordinate(longitude)}
          </dd>
        </div>
      </dl>
    </GlassPanel>
  );
}
