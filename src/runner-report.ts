import { existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, parse as parsePath, resolve } from "node:path";

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

function isAllowedDarwinSystemRootAlias(path: string): boolean {
  return process.platform === "darwin" && (path === "/var" || path === "/tmp" || path === "/etc");
}

function assertNoSymlinkedExistingPathSegments(targetPath: string, label: string): void {
  const resolvedTarget = resolve(targetPath);
  const parsed = parsePath(resolvedTarget);
  let current = parsed.root;
  const segments = resolvedTarget.slice(parsed.root.length).split(/[\\/]+/).filter(Boolean);

  for (const segment of segments) {
    current = join(current, segment);
    if (!existsSync(current)) continue;
    let stat;
    try {
      stat = lstatSync(current);
    } catch {
      throw new Error(`Unsafe ${label}: ${current}`);
    }
    if (stat.isSymbolicLink() && !isAllowedDarwinSystemRootAlias(current)) {
      throw new Error(`Unsafe ${label}: ${current}`);
    }
  }
}

function readArtifact(path: string): string {
  if (!existsSync(path)) return "";
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) return "";
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
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
  if (!reportName || reportName === "." || reportName === ".." || reportName !== basename(reportName)) {
    throw new Error("reportName must be a basename-only file name");
  }
  assertNoSymlinkedExistingPathSegments(artifactsDir, "artifactsDir path segment");
  const artifactsStat = lstatSync(artifactsDir);
  if (artifactsStat.isSymbolicLink() || !artifactsStat.isDirectory()) {
    throw new Error(`artifactsDir must be a regular directory: ${artifactsDir}`);
  }

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

  writeFileSync(reportPath, html, { encoding: "utf8", flag: "wx" });
  return { reportPath, iterations: iterationLines.length, events: eventLines.length };
}
