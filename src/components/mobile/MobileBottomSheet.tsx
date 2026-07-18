"use client";

import type { ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { GlassPanel } from "@/components/primitives/GlassPanel";
import { useReducedMotion } from "@/hooks/useReducedMotion";

type MobileBottomSheetProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  testId?: string;
};

export function MobileBottomSheet({
  open,
  onClose,
  title,
  children,
  testId,
}: MobileBottomSheetProps) {
  const reducedMotion = useReducedMotion();

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={reducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-auto absolute inset-0 bg-black/50"
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.div
            initial={reducedMotion ? false : { y: "100%" }}
            animate={{ y: 0 }}
            exit={reducedMotion ? { opacity: 0 } : { y: "100%" }}
            transition={{ type: "tween", duration: 0.25 }}
            className="pointer-events-auto absolute inset-x-0 bottom-0"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
            role="dialog"
            aria-label={title}
            data-testid={testId}
          >
            <GlassPanel className="max-h-[70vh] overflow-y-auto rounded-b-none p-4">
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" />
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[#F5F7FA]">
                  {title}
                </h2>
                <button
                  type="button"
                  aria-label={`Close ${title}`}
                  onClick={onClose}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[#9AA7B5] transition-colors hover:bg-white/[0.06] hover:text-[#F5F7FA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#55D8E6]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {children}
            </GlassPanel>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
