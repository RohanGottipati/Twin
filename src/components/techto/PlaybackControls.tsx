"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { GlassPanel } from "@/components/primitives/GlassPanel";
import { IconButton } from "@/components/primitives/IconButton";
import { useMapStore } from "@/store/useMapStore";
import type { TransitScenario } from "@/lib/transit/schemas";

function windowLengthMinutes(scenario: TransitScenario): number {
  const startMs = new Date(scenario.window.start).getTime();
  const endMs = new Date(scenario.window.end).getTime();
  return Math.max(1, Math.round((endMs - startMs) / 60_000));
}

function minuteToClock(scenario: TransitScenario, minuteOffset: number): string {
  const start = new Date(scenario.window.start);
  const clock = new Date(start.getTime() + minuteOffset * 60_000);
  const hours = clock.getUTCHours().toString().padStart(2, "0");
  const minutes = clock.getUTCMinutes().toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

export interface PlaybackControlsProps {
  scenario: TransitScenario;
}

/** Scrubs `useMapStore.playbackMinute` across the scenario's observation window, driving whichever map layers key off it. */
export function PlaybackControls({ scenario }: PlaybackControlsProps) {
  const playbackMinute = useMapStore((s) => s.playbackMinute);
  const setPlaybackMinute = useMapStore((s) => s.setPlaybackMinute);
  const [isPlaying, setIsPlaying] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const totalMinutes = windowLengthMinutes(scenario);

  useEffect(() => {
    if (!isPlaying) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(() => {
      const store = useMapStore.getState();
      const next = store.playbackMinute + 1;
      if (next >= totalMinutes) {
        setPlaybackMinute(0);
        setIsPlaying(false);
      } else {
        setPlaybackMinute(next);
      }
    }, 220);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isPlaying, totalMinutes, setPlaybackMinute]);

  return (
    <GlassPanel className="flex flex-col gap-2 p-3" data-testid="playback-controls">
      <div className="flex items-center gap-2">
        <IconButton
          label={isPlaying ? "Pause" : "Play"}
          icon={isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          onClick={() => setIsPlaying((v) => !v)}
          showTooltip={false}
        />
        <IconButton
          label="Reset to start"
          icon={<RotateCcw className="h-4 w-4" />}
          onClick={() => {
            setIsPlaying(false);
            setPlaybackMinute(0);
          }}
          showTooltip={false}
        />
        <input
          type="range"
          min={0}
          max={totalMinutes}
          value={playbackMinute}
          onChange={(event) => setPlaybackMinute(Number(event.target.value))}
          className="flex-1 accent-techto-red"
          aria-label="Playback time"
        />
        <span className="w-12 shrink-0 text-right font-mono text-xs text-techto-text">
          {minuteToClock(scenario, playbackMinute)}
        </span>
      </div>
    </GlassPanel>
  );
}
