"use client";

import { cn } from "@/lib/utils/cn";

type ToggleProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
};

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled = false,
}: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B8DEF]",
        "disabled:cursor-not-allowed disabled:opacity-40",
        "hover:bg-white/[0.04]"
      )}
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-[#F5F7FA]">
          {label}
        </span>
        {description && (
          <span className="block text-xs text-[#9AA7B5]">{description}</span>
        )}
      </span>
      <span
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors",
          checked
            ? "border-[#5B8DEF]/60 bg-[#5B8DEF]/30"
            : "border-white/10 bg-white/[0.06]"
        )}
      >
        <span
          className={cn(
            "inline-block h-4 w-4 transform rounded-full transition-transform",
            checked
              ? "translate-x-6 bg-[#5B8DEF]"
              : "translate-x-1 bg-[#9AA7B5]"
          )}
        />
      </span>
    </button>
  );
}
