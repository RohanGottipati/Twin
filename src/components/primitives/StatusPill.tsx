"use client";

import { cn } from "@/lib/utils/cn";

type StatusPillProps = {
  tone?: "ready" | "loading" | "warning" | "error";
  children: React.ReactNode;
  className?: string;
};

const toneClasses: Record<
  NonNullable<StatusPillProps["tone"]>,
  { dot: string; text: string }
> = {
  ready: { dot: "bg-[#55D8E6]", text: "text-[#55D8E6]" },
  loading: { dot: "bg-[#6287FF] animate-pulse", text: "text-[#6287FF]" },
  warning: { dot: "bg-[#F4B860]", text: "text-[#F4B860]" },
  error: { dot: "bg-[#FF6B6B]", text: "text-[#FF6B6B]" },
};

export function StatusPill({
  tone = "ready",
  children,
  className,
}: StatusPillProps) {
  const classes = toneClasses[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-medium",
        classes.text,
        className
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", classes.dot)} />
      {children}
    </span>
  );
}
