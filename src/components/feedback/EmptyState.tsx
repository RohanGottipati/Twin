"use client";

import type { ReactNode } from "react";

type EmptyStateProps = {
  title: string;
  description?: string;
  icon?: ReactNode;
};

export function EmptyState({ title, description, icon }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-8 text-center">
      {icon && <div className="text-[#9AA7B5]">{icon}</div>}
      <p className="text-sm font-medium text-[#F5F7FA]">{title}</p>
      {description && (
        <p className="text-xs text-[#9AA7B5]">{description}</p>
      )}
    </div>
  );
}
