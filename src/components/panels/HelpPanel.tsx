"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useWorldStore } from "@/store/useWorldStore";
import { GlassPanel } from "@/components/primitives/GlassPanel";
import { useReducedMotion } from "@/hooks/useReducedMotion";

const SHORTCUTS: Array<{ keys: string; description: string }> = [
  { keys: "W", description: "Return to world view" },
  { keys: "T", description: "Open or focus Toronto" },
  { keys: "1", description: "Toronto overview" },
  { keys: "2", description: "Toronto city view" },
  { keys: "3", description: "Toronto close view" },
  { keys: "L", description: "Toggle layers" },
  { keys: "H", description: "Toggle help" },
  { keys: "R", description: "Reset current camera" },
  { keys: "N", description: "Reset north" },
  { keys: "Esc", description: "Close panel or selection" },
];

function Section({
  title,
  items,
}: {
  title: string;
  items: string[];
}) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-widest text-[#55D8E6]">
        {title}
      </h3>
      <ul className="mt-2 flex flex-col gap-1 text-sm text-[#9AA7B5]">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export function HelpPanel() {
  const isOpen = useWorldStore((s) => s.isHelpPanelOpen);
  const toggleHelpPanel = useWorldStore((s) => s.toggleHelpPanel);
  const reducedMotion = useReducedMotion();

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={reducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-auto absolute inset-0 bg-black/40"
            onClick={() => toggleHelpPanel(false)}
            aria-hidden="true"
          />
          <motion.div
            initial={reducedMotion ? false : { opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.2 }}
            className="pointer-events-auto relative w-[min(92vw,560px)]"
            role="dialog"
            aria-label="Help"
            data-testid="help-panel"
          >
            <GlassPanel className="max-h-[80vh] overflow-y-auto p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-[#F5F7FA]">
                  How to explore Skyline
                </h2>
                <button
                  type="button"
                  aria-label="Close help"
                  onClick={() => toggleHelpPanel(false)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#9AA7B5] transition-colors hover:bg-white/[0.06] hover:text-[#F5F7FA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#55D8E6]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-5 grid gap-6 sm:grid-cols-2">
                <Section
                  title="Mouse"
                  items={[
                    "Drag to rotate",
                    "Right-drag or wheel to zoom",
                    "Middle-drag to tilt",
                    "Click a building to inspect it",
                  ]}
                />
                <Section
                  title="Touch"
                  items={[
                    "One finger to rotate",
                    "Pinch to zoom",
                    "Two fingers to tilt",
                    "Tap a building to inspect it",
                  ]}
                />
              </div>

              <div className="mt-6">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-[#55D8E6]">
                  Keyboard shortcuts
                </h3>
                <dl className="mt-2 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                  {SHORTCUTS.map((shortcut) => (
                    <div
                      key={shortcut.keys}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <dt className="text-[#9AA7B5]">
                        {shortcut.description}
                      </dt>
                      <dd>
                        <kbd className="rounded-md border border-white/10 bg-white/[0.06] px-2 py-0.5 text-xs text-[#F5F7FA]">
                          {shortcut.keys}
                        </kbd>
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>

              <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm text-[#9AA7B5]">
                <p>
                  <span className="font-medium text-[#F5F7FA]">
                    World mode
                  </span>{" "}
                  shows the full globe with city markers. Select a city to fly
                  in.
                </p>
                <p className="mt-2">
                  <span className="font-medium text-[#F5F7FA]">
                    City modes
                  </span>{" "}
                  reveal 3D buildings you can select. Toronto is currently the
                  configured demo city.
                </p>
              </div>
            </GlassPanel>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
