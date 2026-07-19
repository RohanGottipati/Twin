"use client";

import dynamic from "next/dynamic";

/** MapLibre needs the DOM; skip SSR for the TechTO product shell. */
export const TechTOClient = dynamic(
  () => import("./TechTOAppShell").then((m) => m.TechTOAppShell),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-dvh w-screen items-center justify-center bg-techto-ink">
        <span className="text-[13px] font-semibold uppercase tracking-[0.3em] text-techto-text">
          TechTO
        </span>
      </div>
    ),
  },
);
