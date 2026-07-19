"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface WaitTimeChartEntry {
  label: string;
  meanWaitMinutes: number;
  p90WaitMinutes: number;
}

export interface WaitTimeChartProps {
  entries: WaitTimeChartEntry[];
}

/** Mean and P90 wait time compared across the baseline and every candidate, so an improvement's tail-risk is visible, not just its average. */
export function WaitTimeChart({ entries }: WaitTimeChartProps) {
  return (
    <div className="h-40 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={entries} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="2 4" stroke="rgba(255,255,255,0.08)" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: "#8B93A3", fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis
            tick={{ fill: "#8B93A3", fontSize: 10 }}
            width={28}
            axisLine={false}
            tickLine={false}
            label={{ value: "min", angle: -90, position: "insideLeft", fill: "#8B93A3", fontSize: 10 }}
          />
          <Tooltip
            contentStyle={{ background: "#0A0D14", border: "1px solid rgba(255,255,255,0.1)", fontSize: 11 }}
            labelStyle={{ color: "#EDEFF3" }}
          />
          <Legend wrapperStyle={{ fontSize: 10, color: "#8B93A3" }} />
          <Bar dataKey="meanWaitMinutes" name="mean wait" fill="#5B8DEF" radius={[3, 3, 0, 0]} />
          <Bar dataKey="p90WaitMinutes" name="p90 wait" fill="#E3A83B" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
