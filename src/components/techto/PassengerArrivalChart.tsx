"use client";

import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ArrivalPoint } from "@/lib/transit/schemas";

export interface PassengerArrivalChartProps {
  arrivalsByMinute: ArrivalPoint[];
  baselineDepartures: string[];
}

/** Minute-by-minute passenger arrival curve, with the scheduled departures marked so the surge-versus-departure misalignment is visible at a glance. */
export function PassengerArrivalChart({ arrivalsByMinute, baselineDepartures }: PassengerArrivalChartProps) {
  const data = arrivalsByMinute.map((point) => ({ minute: point.minute, arrivals: point.arrivals }));

  return (
    <div className="h-40 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="arrivalFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#5B8DEF" stopOpacity={0.5} />
              <stop offset="100%" stopColor="#5B8DEF" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="2 4" stroke="rgba(255,255,255,0.08)" vertical={false} />
          <XAxis
            dataKey="minute"
            tick={{ fill: "#8B93A3", fontSize: 10 }}
            interval={Math.max(0, Math.floor(data.length / 6))}
            axisLine={false}
            tickLine={false}
          />
          <YAxis tick={{ fill: "#8B93A3", fontSize: 10 }} width={28} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{ background: "#0A0D14", border: "1px solid rgba(255,255,255,0.1)", fontSize: 11 }}
            labelStyle={{ color: "#EDEFF3" }}
          />
          {baselineDepartures.map((departure) => (
            <ReferenceLine
              key={departure}
              x={departure}
              stroke="#E0333B"
              strokeDasharray="3 3"
              label={{ value: departure, position: "top", fill: "#E0333B", fontSize: 10 }}
            />
          ))}
          <Area type="monotone" dataKey="arrivals" stroke="#5B8DEF" fill="url(#arrivalFill)" strokeWidth={1.5} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
