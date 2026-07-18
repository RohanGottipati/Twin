"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { Tooltip } from "./Tooltip";

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  icon: ReactNode;
  active?: boolean;
  tooltipSide?: "top" | "bottom" | "left" | "right";
  showTooltip?: boolean;
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      label,
      icon,
      active = false,
      tooltipSide = "left",
      showTooltip = true,
      className,
      ...rest
    },
    ref
  ) {
    const button = (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        aria-pressed={active}
        className={cn(
          "inline-flex h-11 w-11 items-center justify-center rounded-xl border text-[#F5F7FA] transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#55D8E6] focus-visible:ring-offset-2 focus-visible:ring-offset-[#070A0F]",
          "disabled:cursor-not-allowed disabled:opacity-40",
          active
            ? "border-[#55D8E6]/60 bg-[#55D8E6]/15 text-[#55D8E6]"
            : "border-white/10 bg-white/[0.04] hover:bg-white/[0.08]",
          className
        )}
        {...rest}
      >
        {icon}
      </button>
    );

    if (!showTooltip) {
      return button;
    }

    return (
      <Tooltip label={label} side={tooltipSide}>
        {button}
      </Tooltip>
    );
  }
);
