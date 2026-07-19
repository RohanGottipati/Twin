"use client";

import { useState } from "react";
import { Check, FileDown } from "lucide-react";
import {
  exportChatReportToPdf,
  type ChatReportInput,
} from "@/lib/export/chat-report";
import { cn } from "@/lib/utils/cn";

export function PdfExportButton({
  report,
  compact = false,
  className,
  testId,
}: {
  report: ChatReportInput;
  compact?: boolean;
  className?: string;
  testId?: string;
}) {
  const [status, setStatus] = useState<"idle" | "opened" | "blocked">("idle");

  function onExport() {
    const opened = exportChatReportToPdf(report);
    setStatus(opened ? "opened" : "blocked");
    window.setTimeout(() => setStatus("idle"), 2500);
  }

  const label =
    status === "blocked"
      ? "Allow pop-ups to export"
      : status === "opened"
        ? "Print dialog opened"
        : "Export PDF";

  return (
    <button
      type="button"
      onClick={onExport}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-full text-white/60 transition hover:bg-white/15 hover:text-white",
        compact ? "h-6 w-6" : "h-7 px-2 text-[11px]",
        className,
      )}
      aria-label={label}
      title={label}
      data-testid={testId}
    >
      {status === "opened" ? (
        <Check className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <FileDown className="h-3.5 w-3.5" aria-hidden />
      )}
      {!compact && (
        <span>{status === "blocked" ? "Pop-up blocked" : "Export PDF"}</span>
      )}
    </button>
  );
}
