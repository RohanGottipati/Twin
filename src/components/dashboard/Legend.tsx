"use client";

import {
  ACCEPT_NEUTRAL,
  ACCEPT_OPPOSE,
  ACCEPT_SUPPORT,
  BUS_COLOR,
} from "@/lib/map/palette";

export function Legend() {
  return (
    <div className="rounded-md border border-white/[0.07] bg-black/50 px-2.5 py-2 backdrop-blur-md">
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[7.5px] uppercase tracking-wide text-muted/70">
          oppose
        </span>
        <span
          aria-hidden
          className="h-[4px] w-16 rounded-full opacity-80"
          style={{
            background: `linear-gradient(90deg, ${ACCEPT_OPPOSE}, ${ACCEPT_NEUTRAL}, ${ACCEPT_SUPPORT})`,
          }}
        />
        <span className="font-mono text-[7.5px] uppercase tracking-wide text-muted/70">
          support
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-2.5">
        <span className="flex items-center gap-1">
          <span aria-hidden className="h-[2px] w-3 rounded-full bg-[#e0cb3c]" />
          <span className="font-mono text-[7.5px] uppercase tracking-wide text-muted/70">subway</span>
        </span>
        <span className="flex items-center gap-1">
          <span aria-hidden className="h-[2px] w-3 rounded-full bg-[#7f6ff0]" />
          <span className="font-mono text-[7.5px] uppercase tracking-wide text-muted/70">streetcar</span>
        </span>
        <span className="flex items-center gap-1">
          <span
            aria-hidden
            className="h-[2px] w-3 rounded-full"
            style={{ background: BUS_COLOR }}
          />
          <span className="font-mono text-[7.5px] uppercase tracking-wide text-muted/70">bus</span>
        </span>
        <span className="flex items-center gap-1">
          <span
            aria-hidden
            className="h-[2px] w-3 rounded-full"
            style={{
              backgroundImage:
                "repeating-linear-gradient(90deg, #cfd8d0 0 3px, transparent 3px 6px)",
            }}
          />
          <span className="font-mono text-[7.5px] uppercase tracking-wide text-muted/70">proposed</span>
        </span>
      </div>
    </div>
  );
}
