import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildChatReportHtml,
  chatMarkdownToReportHtml,
  exportChatReportToPdf,
} from "@/lib/export/chat-report";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("chat report export", () => {
  it("formats headings, lists, and tables for print", () => {
    const html = chatMarkdownToReportHtml(`## ROI and value case

- Lifecycle costs: **validate first**
- Benefit-cost ratio: pending

| Metric | Status |
| --- | --- |
| NPV | Not claimed |`);

    expect(html).toContain("<h3>ROI and value case</h3>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<strong>validate first</strong>");
    expect(html).toContain("<table>");
    expect(html).toContain("<td>Not claimed</td>");
  });

  it("escapes model text and includes evidence and limitations", () => {
    const html = buildChatReportHtml({
      title: "Wychwood <script>alert(1)</script>",
      subtitle: "Toronto planning answer",
      exportedAt: new Date("2026-07-18T16:00:00-04:00"),
      messages: [
        { role: "user", content: "What is the ROI?" },
        {
          role: "assistant",
          content: "## ROI\nNo figure is claimed. <img src=x onerror=alert(1)>",
          citedEvidence: ["City source <unsafe>"],
        },
      ],
    });

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("City source &lt;unsafe&gt;");
    expect(html).toContain("Simulated day-one acceptance is not public consultation");
    expect(html).toContain("lifecycle costs");
    expect(html).toContain("@media print");
  });

  it("opens the print-ready report and invokes the browser print dialog", () => {
    vi.useFakeTimers();
    const reportWindow = {
      opener: window,
      document: {
        open: vi.fn(),
        write: vi.fn(),
        close: vi.fn(),
      },
      focus: vi.fn(),
      print: vi.fn(),
    } as unknown as Window;
    vi.spyOn(window, "open").mockReturnValue(reportWindow);

    const opened = exportChatReportToPdf({
      title: "Toronto answer",
      messages: [{ role: "assistant", content: "## Recommendation\nProceed to validation." }],
    });

    expect(opened).toBe(true);
    expect(reportWindow.document.write).toHaveBeenCalledWith(
      expect.stringContaining("Toronto answer"),
    );
    vi.runAllTimers();
    expect(reportWindow.focus).toHaveBeenCalledOnce();
    expect(reportWindow.print).toHaveBeenCalledOnce();
  });

  it("reports a blocked export when the browser denies the new window", () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    expect(
      exportChatReportToPdf({
        title: "Toronto answer",
        messages: [{ role: "assistant", content: "Answer" }],
      }),
    ).toBe(false);
  });
});
