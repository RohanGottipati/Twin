"use client";

import { cn } from "@/lib/utils/cn";

type StatusPillProps = {
  tone?: "ready" | "loading" | "warning" | "error";
  children: React.ReactNode;
  className?: string;
  "data-testid"?: string;
};

const toneClasses: Record<
  NonNullable<StatusPillProps["tone"]>,
  { dot: string; text: string }
> = {
  ready: { dot: "bg-[#5B8DEF]", text: "text-[#5B8DEF]" },
  loading: { dot: "bg-[#5B8DEF] animate-pulse", text: "text-[#5B8DEF]" },
  warning: { dot: "bg-[#E3A83B]", text: "text-[#E3A83B]" },
  error: { dot: "bg-[#FF6B6B]", text: "text-[#FF6B6B]" },
};

export function StatusPill({
  tone = "ready",
  children,
  className,
  "data-testid": dataTestId,
}: StatusPillProps) {
  const classes = toneClasses[tone];
  return (
    <span
      data-testid={dataTestId}
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
