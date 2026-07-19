"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DepartureLoad } from "@/lib/transit/schemas";

export interface DepartureLoadChartProps {
  departureLoads: DepartureLoad[];
}

/** Boarded vs. denied riders per departure, the clearest single view of the load-imbalance problem this demo targets. */
export function DepartureLoadChart({ departureLoads }: DepartureLoadChartProps) {
  const data = departureLoads.map((load) => ({
    departure: load.actualTime,
    boarded: load.boarded,
    denied: load.denied,
  }));

  return (
    <div className="h-40 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="2 4" stroke="rgba(255,255,255,0.08)" vertical={false} />
          <XAxis dataKey="departure" tick={{ fill: "#8B93A3", fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: "#8B93A3", fontSize: 10 }} width={28} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{ background: "#0A0D14", border: "1px solid rgba(255,255,255,0.1)", fontSize: 11 }}
            labelStyle={{ color: "#EDEFF3" }}
          />
          <Legend wrapperStyle={{ fontSize: 10, color: "#8B93A3" }} />
          <Bar dataKey="boarded" stackId="a" fill="#3FBF9F" radius={[3, 3, 0, 0]} />
          <Bar dataKey="denied" stackId="a" fill="#E0333B" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
