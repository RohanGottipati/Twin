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
  ready: { dot: "bg-[#007ACC]", text: "text-[#007ACC]" },
  loading: { dot: "bg-[#007ACC] animate-pulse", text: "text-[#007ACC]" },
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
"inline-flex items-center gap-2 border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-medium",
        classes.text,
        className
      )}
    >
 <span className={cn("h-1.5 w-1.5", classes.dot)} />
      {children}
    </span>
  );
}
