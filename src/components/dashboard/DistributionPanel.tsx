"use client";

import { useState } from "react";
import { useSimStore } from "@/store/useSimStore";
import { acceptanceColor } from "@/lib/map/palette";
import { HISTOGRAM_BINS } from "@/lib/sim/types";

const W = 416;
const H = 74;
const GAP = 2;

export function DistributionPanel() {
  const result = useSimStore((s) => s.result);
  const personaCount = useSimStore((s) => s.personaCount);
  const [hover, setHover] = useState<number | null>(null);

  if (!result) return null;

  const max = Math.max(...result.histogram, 1);
  const barW = (W - GAP * (HISTOGRAM_BINS - 1)) / HISTOGRAM_BINS;
  const neutralX = 0.5 * W - GAP / 2;

  return (
    <section className="pointer-events-auto w-[464px] border border-hairline bg-panel px-5 pb-3.5 pt-3">
      <header className="flex items-baseline justify-between">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
          Day-one acceptance
        </h2>
        <span className="font-mono text-[9px] text-muted/60">
          n={personaCount.toLocaleString()}
        </span>
      </header>

      <div className="mt-2.5 flex items-end gap-6">
        <Stat
          label="oppose"
          value={`${Math.round(result.opposeShare * 100)}%`}
          color={acceptanceColor(0.1)}
        />
        <Stat
          label="mixed"
          value={`${Math.round(
            (1 - result.opposeShare - result.supportShare) * 100
          )}%`}
          color="#8a8f8a"
        />
        <Stat
          label="support"
          value={`${Math.round(result.supportShare * 100)}%`}
          color={acceptanceColor(0.9)}
        />
        <Stat label="mean" value={result.mean.toFixed(2)} />
      </div>

      <div className="relative mt-2">
        <svg
          width="100%"
          viewBox={`0 0 ${W} ${H + 14}`}
          role="img"
          aria-label="Histogram of resident acceptance from oppose to support"
          onMouseLeave={() => setHover(null)}
        >
          {result.histogram.map((count, i) => {
            const h = Math.max(count > 0 ? 2 : 0, (count / max) * H);
            const x = i * (barW + GAP);
            const mid = (i + 0.5) / HISTOGRAM_BINS;
            return (
              <g key={i}>
                <rect
                  x={x}
                  y={H - h}
                  width={barW}
                  height={h}
                  rx={1.5}
                  fill={acceptanceColor(mid)}
                  opacity={hover === null || hover === i ? 1 : 0.45}
                />
                <rect
                  x={x - GAP / 2}
                  y={0}
                  width={barW + GAP}
                  height={H}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                />
              </g>
            );
          })}
          <line
            x1={0}
            y1={H + 0.5}
            x2={W}
            y2={H + 0.5}
            stroke="rgba(235,242,236,0.16)"
          />
          <line
            x1={neutralX}
            y1={0}
            x2={neutralX}
            y2={H}
            stroke="rgba(235,242,236,0.22)"
            strokeDasharray="2 3"
          />
          <text
            x={0}
            y={H + 11}
            className="fill-[#98a29b] font-mono text-[8.5px]"
          >
            oppose
          </text>
          <text
            x={W}
            y={H + 11}
            textAnchor="end"
            className="fill-[#98a29b] font-mono text-[8.5px]"
          >
            support
          </text>
          <text
            x={neutralX}
            y={H + 11}
            textAnchor="middle"
            className="fill-[#98a29b]/70 font-mono text-[8.5px]"
          >
            0.5
          </text>
        </svg>
        {hover !== null && (
          <div
            className="pointer-events-none absolute -top-1 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-sm border border-white/10 bg-[#14181a]/95 px-2 py-1 font-mono text-[10px] text-ink-dim"
            style={{
              left: `${(((hover + 0.5) * (barW + GAP)) / W) * 100}%`,
            }}
          >
            {(hover / HISTOGRAM_BINS).toFixed(2)}–
            {((hover + 1) / HISTOGRAM_BINS).toFixed(2)} ·{" "}
            {result.histogram[hover].toLocaleString()} residents
          </div>
        )}
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      {color && (
        <span
          aria-hidden
          className="inline-block h-[7px] w-[7px] rounded-full"
          style={{ backgroundColor: color }}
        />
      )}
      <span className="font-mono text-[15px] font-medium text-ink-bright">
        {value}
      </span>
      <span className="text-[10px] uppercase tracking-wider text-muted">
        {label}
      </span>
    </div>
  );
}
