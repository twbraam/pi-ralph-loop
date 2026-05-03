import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type StaticRunnerReportResult = {
  reportPath: string;
  iterations: number;
  events: number;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function readArtifact(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function nonEmptyLines(value: string): string[] {
  return value.split("\n").filter((line) => line.trim().length > 0);
}

function renderJsonLineList(lines: string[]): string {
  if (lines.length === 0) return "<p>No records found.</p>";

  const items = lines.map((line) => {
    let label = line;
    try {
      const parsed: unknown = JSON.parse(line);
      if (parsed && typeof parsed === "object") {
        const record = parsed as Record<string, unknown>;
        const preferred = record.iteration ?? record.type ?? record.event ?? record.status ?? record.summary ?? record.message;
        if (preferred !== undefined) label = String(preferred);
      }
    } catch {
      // Keep the raw JSONL line as the label when a line is malformed.
    }
    return `<li><code>${escapeHtml(label)}</code></li>`;
  });

  return `<ol>\n${items.join("\n")}\n</ol>`;
}

export function generateStaticRunnerReport(artifactsDir: string, reportName = "report.html"): StaticRunnerReportResult {
  const status = readArtifact(join(artifactsDir, "status.json"));
  const iterationsJsonl = readArtifact(join(artifactsDir, "iterations.jsonl"));
  const eventsJsonl = readArtifact(join(artifactsDir, "events.jsonl"));
  const iterationLines = nonEmptyLines(iterationsJsonl);
  const eventLines = nonEmptyLines(eventsJsonl);
  const reportPath = join(artifactsDir, reportName);

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Ralph Run Report</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; line-height: 1.5; }
    pre { background: #f6f8fa; padding: 1rem; overflow: auto; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  </style>
</head>
<body>
  <h1>Ralph Run Report</h1>
  <p>Static report generated from exported <code>.ralph-runner</code> artifacts. JSONL files remain canonical.</p>
  <ul>
    <li>Iterations: ${iterationLines.length}</li>
    <li>Events: ${eventLines.length}</li>
  </ul>
  <h2>Status</h2>
  <pre>${escapeHtml(status || "No status.json exported.")}</pre>
  <h2>Iteration Summary</h2>
  ${renderJsonLineList(iterationLines)}
  <h2>Event Summary</h2>
  ${renderJsonLineList(eventLines)}
  <h2>Canonical iterations.jsonl</h2>
  <pre>${escapeHtml(iterationsJsonl || "No iterations.jsonl exported.")}</pre>
  <h2>Canonical events.jsonl</h2>
  <pre>${escapeHtml(eventsJsonl || "No events.jsonl exported.")}</pre>
</body>
</html>
`;

  writeFileSync(reportPath, html, "utf8");
  return { reportPath, iterations: iterationLines.length, events: eventLines.length };
}
