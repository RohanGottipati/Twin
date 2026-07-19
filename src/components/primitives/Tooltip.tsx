"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

type TooltipProps = {
  label: string;
  side?: "top" | "bottom" | "left" | "right";
  children: ReactNode;
};

const sideClasses: Record<
  NonNullable<TooltipProps["side"]>,
  string
> = {
  top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
  bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
  left: "right-full top-1/2 -translate-y-1/2 mr-2",
  right: "left-full top-1/2 -translate-y-1/2 ml-2",
};

export function Tooltip({
  label,
  side = "left",
  children,
}: TooltipProps) {
  const [visible, setVisible] = useState(false);

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {children}
      {visible && (
        <span
          role="tooltip"
          className={cn(
"pointer-events-none absolute z-50 whitespace-nowrap border border-white/10 bg-[rgba(8,13,21,0.95)] px-2 py-1 text-xs text-[#F5F7FA]",
            sideClasses[side]
          )}
        >
          {label}
        </span>
      )}
    </span>
  );
}
