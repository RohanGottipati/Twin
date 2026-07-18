"use client";

import type { ReactNode } from "react";
import { GlassPanel } from "@/components/primitives/GlassPanel";

type TopNavigationProps = {
  /** Right-aligned status badges, e.g. mock-mode or data-mode pills. */
  statusSlot?: ReactNode;
  /** Center-aligned scenario/context label, hidden on small screens. */
  contextSlot?: ReactNode;
  /** Left-aligned action, e.g. a back button or menu toggle. */
  leadingSlot?: ReactNode;
};

/**
 * Generic branding + status bar, deliberately store-agnostic: TwinTOAppShell
 * supplies whatever it wants rendered in each slot rather than this
 * component reaching into any store itself, so it stays reusable.
 */
export function TopNavigation({ statusSlot, contextSlot, leadingSlot }: TopNavigationProps) {
  return (
    <GlassPanel className="pointer-events-auto flex items-center justify-between gap-3 px-3 py-2 sm:px-4">
      <div className="flex items-center gap-3">
        {leadingSlot}
        <div className="leading-tight">
          <p className="flex items-center gap-1.5 text-sm font-semibold tracking-wide text-twinto-text">
            <span className="inline-block h-2 w-2 rounded-full bg-twinto-red" aria-hidden="true" />
            TwinTO
          </p>
          <p className="text-[10px] uppercase tracking-widest text-twinto-muted">
            Toronto only · Transit Digital Twin
          </p>
        </div>
      </div>

      {contextSlot && <div className="hidden text-center sm:block">{contextSlot}</div>}

      <div className="flex items-center gap-2">{statusSlot}</div>
    </GlassPanel>
  );
}
