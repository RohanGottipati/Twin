export interface ChatReportMessage {
  role: "user" | "assistant" | "system";
  content: string;
  citedEvidence?: string[];
}

export interface ChatReportInput {
  title: string;
  subtitle?: string;
  messages: ChatReportMessage[];
  exportedAt?: Date;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function inlineMarkdown(value: string): string {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function isTableDivider(line: string): boolean {
  const cells = line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|");
  return cells.length > 0 && cells.every((cell) => /^\s*:?-{3,}:?\s*$/.test(cell));
}

function tableCells(line: string): string[] {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((cell) => inlineMarkdown(cell.trim()));
}

/**
 * Converts the small Markdown subset used by chat answers into escaped report
 * markup. Model output is escaped before any report-owned tags are inserted.
 */
export function chatMarkdownToReportHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const html: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let inCodeBlock = false;
  let codeLines: string[] = [];

  const closeList = () => {
    if (listType) html.push(`</${listType}>`);
    listType = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (/^\s*```/.test(line)) {
      closeList();
      if (inCodeBlock) {
        html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeLines = [];
      }
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    const nextLine = lines[index + 1] ?? "";
    if (line.includes("|") && isTableDivider(nextLine)) {
      closeList();
      const headers = tableCells(line);
      html.push("<table><thead><tr>");
      headers.forEach((cell) => html.push(`<th>${cell}</th>`));
      html.push("</tr></thead><tbody>");
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        html.push("<tr>");
        tableCells(lines[index]).forEach((cell) => html.push(`<td>${cell}</td>`));
        html.push("</tr>");
        index += 1;
      }
      html.push("</tbody></table>");
      index -= 1;
      continue;
    }

    const heading = line.match(/^\s*(#{1,3})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = Math.min(3, heading[1].length + 1);
      html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const unordered = line.match(/^\s*(?:[-*•])\s+(.+)$/);
    if (unordered) {
      if (listType !== "ul") {
        closeList();
        html.push("<ul>");
        listType = "ul";
      }
      html.push(`<li>${inlineMarkdown(unordered[1])}</li>`);
      continue;
    }

    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (ordered) {
      if (listType !== "ol") {
        closeList();
        html.push("<ol>");
        listType = "ol";
      }
      html.push(`<li>${inlineMarkdown(ordered[1])}</li>`);
      continue;
    }

    closeList();
    if (!line.trim()) continue;
    if (/^\s*(?:---+|___+)\s*$/.test(line)) {
      html.push("<hr>");
    } else if (/^\s*>\s?/.test(line)) {
      html.push(`<blockquote>${inlineMarkdown(line.replace(/^\s*>\s?/, ""))}</blockquote>`);
    } else if (
      line.length <= 80 &&
      /[A-Z]/.test(line) &&
      line === line.toUpperCase() &&
      /^[A-Z0-9][A-Z0-9 &/(),:+-]+$/.test(line)
    ) {
      html.push(`<h2>${inlineMarkdown(line)}</h2>`);
    } else {
      html.push(`<p>${inlineMarkdown(line)}</p>`);
    }
  }

  closeList();
  if (inCodeBlock && codeLines.length) {
    html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  }
  return html.join("\n");
}

export function buildChatReportHtml(input: ChatReportInput): string {
  const exportedAt = input.exportedAt ?? new Date();
  const messages = input.messages.filter((message) => message.content.trim());
  const content = messages
    .map((message, index) => {
      const label =
        message.role === "user"
          ? "Question"
          : message.role === "assistant"
            ? "TechTO response"
            : "Context";
      const sources = message.citedEvidence?.filter(Boolean) ?? [];
      const sourceMarkup = sources.length
        ? `<section class="sources"><h3>Sources and evidence</h3><ul>${sources
            .map((source) => `<li>${escapeHtml(source)}</li>`)
            .join("")}</ul></section>`
        : "";
      return `<article class="message ${message.role}">
        <div class="message-label">${escapeHtml(label)}${messages.length > 2 ? ` ${index + 1}` : ""}</div>
        ${chatMarkdownToReportHtml(message.content)}
        ${sourceMarkup}
      </article>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(input.title)}</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #eef3f7; color: #172333; font: 11pt/1.55 Arial, Helvetica, sans-serif; }
    main { width: min(8.5in, 100%); margin: 0 auto; background: white; padding: 0.7in; }
    header { border-bottom: 3px solid #167b82; margin-bottom: 28px; padding-bottom: 18px; }
    .eyebrow, .message-label { color: #167b82; font-size: 9pt; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
    h1 { font-size: 24pt; line-height: 1.1; margin: 6px 0; }
    h2 { color: #17485a; font-size: 15pt; line-height: 1.25; margin: 22px 0 8px; }
    h3 { color: #285d69; font-size: 12pt; margin: 16px 0 6px; }
    p { margin: 7px 0; }
    ul, ol { margin: 7px 0 10px; padding-left: 22px; }
    li { margin: 3px 0; }
    code { background: #edf3f4; border-radius: 3px; padding: 1px 4px; }
    pre { background: #edf3f4; border-radius: 6px; overflow-wrap: anywhere; padding: 10px; white-space: pre-wrap; }
    blockquote { border-left: 3px solid #82adb1; color: #445865; margin: 10px 0; padding-left: 12px; }
    hr { border: 0; border-top: 1px solid #cbd7dc; margin: 18px 0; }
    table { border-collapse: collapse; margin: 12px 0; width: 100%; }
    th, td { border: 1px solid #c5d1d6; padding: 7px; text-align: left; vertical-align: top; }
    th { background: #e8f1f2; color: #17485a; }
    .subtitle, .meta { color: #5d6c76; }
    .subtitle { font-size: 12pt; margin-top: 8px; }
    .meta { font-size: 9pt; margin-top: 12px; }
    .message { border: 1px solid #d6e0e4; border-radius: 9px; margin: 0 0 18px; padding: 16px 18px; }
    .message.user { background: #f3f7f8; break-inside: avoid-page; }
    .message.assistant { border-left: 5px solid #167b82; }
    .sources { border-top: 1px solid #d6e0e4; margin-top: 18px; padding-top: 4px; }
    .sources li { overflow-wrap: anywhere; }
    .notice { background: #f7f3e8; border: 1px solid #dfcf9f; border-radius: 7px; color: #554a2e; font-size: 9.5pt; margin-top: 24px; padding: 12px 14px; }
    footer { color: #697781; font-size: 8.5pt; margin-top: 20px; }
    @page { size: auto; margin: 0.55in; }
    @media print {
      body { background: white; }
      main { margin: 0; padding: 0; width: auto; }
      h2, h3 { break-after: avoid-page; }
      table { break-inside: avoid-page; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div class="eyebrow">TechTO planning report</div>
      <h1>${escapeHtml(input.title)}</h1>
      ${input.subtitle ? `<div class="subtitle">${escapeHtml(input.subtitle)}</div>` : ""}
      <div class="meta">Toronto, Ontario · Exported ${escapeHtml(exportedAt.toLocaleString("en-CA", { timeZone: "America/Toronto", timeZoneName: "short" }))}</div>
    </header>
    ${content || "<p>No conversation content was available to export.</p>"}
    <aside class="notice"><strong>Decision-support limitation:</strong> Simulated day-one acceptance is not public consultation. Potential accessibility, ridership, cost, carbon, economic, and ROI effects are not consequence forecasts. Validate assumptions, lifecycle costs, monetized benefits, uncertainty ranges, and local evidence before making a decision.</aside>
    <footer>Generated from TechTO. Geographic scope: City of Toronto.</footer>
  </main>
</body>
</html>`;
}

/** Opens a print-ready report. The browser print dialog provides Save as PDF. */
export function exportChatReportToPdf(input: ChatReportInput): boolean {
  const reportWindow = window.open("", "_blank");
  if (!reportWindow) return false;

  reportWindow.opener = null;
  reportWindow.document.open();
  reportWindow.document.write(buildChatReportHtml(input));
  reportWindow.document.close();
  window.setTimeout(() => {
    reportWindow.focus();
    reportWindow.print();
  }, 250);
  return true;
}
