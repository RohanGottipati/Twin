"use client";

import dynamic from "next/dynamic";

// MapLibre needs the DOM; skip SSR for the whole dashboard surface.
export const DashboardClient = dynamic(
  () => import("./Dashboard").then((m) => m.Dashboard),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-dvh w-screen items-center justify-center bg-ink">
        <span className="font-ui text-[13px] font-semibold uppercase tracking-[0.3em] text-ink-bright">
          TechTO
        </span>
      </div>
    ),
  }
);
