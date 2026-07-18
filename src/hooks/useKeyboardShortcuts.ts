"use client";

import { useEffect } from "react";

export type ShortcutHandlers = {
  onWorld: () => void;
  onToronto: () => void;
  onTorontoOverview: () => void;
  onTorontoCity: () => void;
  onTorontoClose: () => void;
  onToggleLayers: () => void;
  onToggleHelp: () => void;
  onResetView: () => void;
  onResetNorth: () => void;
  onEscape: () => void;
};

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    target.isContentEditable
  );
}

export function useKeyboardShortcuts(handlers: ShortcutHandlers): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (isTypingTarget(event.target)) {
        return;
      }

      switch (event.key) {
        case "w":
        case "W":
          handlers.onWorld();
          break;
        case "t":
        case "T":
          handlers.onToronto();
          break;
        case "1":
          handlers.onTorontoOverview();
          break;
        case "2":
          handlers.onTorontoCity();
          break;
        case "3":
          handlers.onTorontoClose();
          break;
        case "l":
        case "L":
          handlers.onToggleLayers();
          break;
        case "h":
        case "H":
          handlers.onToggleHelp();
          break;
        case "r":
        case "R":
          handlers.onResetView();
          break;
        case "n":
        case "N":
          handlers.onResetNorth();
          break;
        case "Escape":
          handlers.onEscape();
          break;
        default:
          return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handlers]);
}
