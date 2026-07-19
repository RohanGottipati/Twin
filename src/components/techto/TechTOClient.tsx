"use client";

import dynamic from "next/dynamic";

/** MapLibre needs the DOM; skip SSR for the TwinTO product shell. */
export const TwinTOClient = dynamic(
  () => import("./TwinTOAppShell").then((m) => m.TwinTOAppShell),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-dvh w-screen items-center justify-center bg-twinto-ink">
        <span className="text-[13px] font-semibold uppercase tracking-[0.3em] text-twinto-text">
          TwinTO
        </span>
      </div>
    ),
  },
);
