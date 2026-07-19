"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils/cn";

export function ChatMarkdown({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "chat-md text-[12px] leading-relaxed text-white/90",
        "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        "[&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_li]:my-0.5",
        "[&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4",
        "[&_strong]:font-semibold [&_strong]:text-white",
        "[&_em]:italic",
        "[&_a]:text-sky-200 [&_a]:underline [&_a]:underline-offset-2",
"[&_code]: [&_code]:bg-white/15 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[11px]",
"[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]: [&_pre]:bg-black/25 [&_pre]:p-2",
        "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
        "[&_h1]:mb-1 [&_h1]:mt-2 [&_h1]:text-[14px] [&_h1]:font-semibold [&_h1]:text-white",
        "[&_h2]:mb-1 [&_h2]:mt-2 [&_h2]:text-[13px] [&_h2]:font-semibold [&_h2]:text-white",
        "[&_h3]:mb-1 [&_h3]:mt-2 [&_h3]:text-[12px] [&_h3]:font-semibold [&_h3]:text-white",
        "[&_blockquote]:my-1.5 [&_blockquote]:border-l-2 [&_blockquote]:border-white/30 [&_blockquote]:pl-2 [&_blockquote]:text-white/70",
        "[&_hr]:my-2 [&_hr]:border-white/20",
        "[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_table]:text-[11px]",
        "[&_th]:border [&_th]:border-white/20 [&_th]:bg-white/10 [&_th]:px-1.5 [&_th]:py-1 [&_th]:text-left",
        "[&_td]:border [&_td]:border-white/15 [&_td]:px-1.5 [&_td]:py-1",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
