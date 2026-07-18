"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { GlassPanel } from "@/components/primitives/GlassPanel";

type SceneErrorOverlayProps = {
  title: string;
  message: string;
  onRetry?: () => void;
  instructions?: React.ReactNode;
};

export function SceneErrorOverlay({
  title,
  message,
  onRetry,
  instructions,
}: SceneErrorOverlayProps) {
  return (
    <div
      className="absolute inset-0 z-[70] flex items-center justify-center bg-[#070A0F] p-6"
      role="alert"
      aria-live="assertive"
      data-testid="scene-error"
    >
      <GlassPanel className="w-full max-w-md p-8 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-[#FF6B6B]/40 bg-[#FF6B6B]/10">
          <AlertTriangle className="h-7 w-7 text-[#FF6B6B]" />
        </div>
        <h2 className="mt-6 text-xl font-semibold text-[#F5F7FA]">{title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-[#9AA7B5]">
          {message}
        </p>
        {instructions && (
          <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-left text-xs text-[#9AA7B5]">
            {instructions}
          </div>
        )}
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-6 inline-flex items-center gap-2 rounded-xl border border-[#55D8E6]/50 bg-[#55D8E6]/15 px-4 py-2 text-sm font-medium text-[#55D8E6] transition-colors hover:bg-[#55D8E6]/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#55D8E6]"
          >
            <RefreshCw className="h-4 w-4" />
            Try again
          </button>
        )}
      </GlassPanel>
    </div>
  );
}
