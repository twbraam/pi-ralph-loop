import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";

const DEFAULT_RECENT_ITERATIONS = 5;
const DEFAULT_TRANSCRIPT_TAIL_CHARS = 1200;
const SUMMARY_ARTIFACT_MAX_BYTES = 256 * 1024;
const TRANSCRIPT_REFERENCE_MAX = 20;
const RALPH_PROGRESS_FILE = "RALPH_PROGRESS.md";
const FINAL_SUMMARY_FILE = "final-summary.md";

type SummaryStatus = {
  loopToken?: string;
  status: string;
  currentIteration: number;
  maxIterations: number;
  startedAt: string;
  completedAt?: string;
};

type SummaryIterationRecord = {
  iteration: number;
  status: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  progress: boolean | "unknown";
  changedFiles: string[];
  noProgressStreak: number;
  completionGate?: { ready: boolean; reasons: string[] };
  commandOutcomes?: StructuredCommandOutcome[];
  loopToken?: string;
};

type StructuredCommandOutcome = {
  name: string;
  status: string;
  acceptance?: boolean;
  blockedPattern?: string;
  durationMs?: number;
};

export type RalphRunSummaryOptions = {
  recentIterations?: number;
  transcriptTailChars?: number;
};

function readRegularFileBounded(filePath: string, label: string, maxBytes = SUMMARY_ARTIFACT_MAX_BYTES, mode: "head" | "tail" = "head"): string {
  if (!existsSync(filePath)) return `${label} not found.`;
  let fd: number | undefined;
  try {
    const stat = lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) return `${label} is not a regular file.`;
    const bytesToRead = Math.min(stat.size, Math.max(0, maxBytes));
    const offset = mode === "tail" ? Math.max(0, stat.size - bytesToRead) : 0;
    const buffer = Buffer.alloc(bytesToRead);
    fd = openSync(filePath, "r");
    const bytesRead = bytesToRead > 0 ? readSync(fd, buffer, 0, bytesToRead, offset) : 0;
    const text = buffer.toString("utf8", 0, bytesRead).trim();
    const fallback = text || `${label} is empty.`;
    if (stat.size <= maxBytes) return fallback;
    return mode === "tail"
      ? `[truncated to last ${maxBytes} bytes from ${stat.size} bytes]\n${fallback}`
      : `${fallback}\n[truncated to first ${maxBytes} bytes from ${stat.size} bytes]`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `${label} unreadable: ${message}`;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function tailText(value: string, maxChars: number): string {
  if (maxChars <= 0) return "";
  if (value.length <= maxChars) return value;
  return `[truncated to last ${maxChars} chars]\n${value.slice(value.length - maxChars)}`;
}

function parseJsonLines(raw: string): unknown[] {
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0 && !line.startsWith("[truncated "))
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function coerceProgress(value: unknown): boolean | "unknown" {
  return value === true || value === false || value === "unknown" ? value : "unknown";
}

function coerceCompletionGate(value: unknown): { ready: boolean; reasons: string[] } | undefined {
  const record = asRecord(value);
  if (!record || typeof record.ready !== "boolean") return undefined;
  return { ready: record.ready, reasons: stringArray(record.reasons) };
}

function coerceCommandOutcomes(value: unknown): StructuredCommandOutcome[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const outcomes = value.flatMap((entry): StructuredCommandOutcome[] => {
    const outcome = asRecord(entry);
    if (!outcome || typeof outcome.name !== "string" || typeof outcome.status !== "string") return [];
    return [{
      name: outcome.name,
      status: outcome.status,
      ...(outcome.acceptance === true ? { acceptance: true } : {}),
      ...(typeof outcome.blockedPattern === "string" ? { blockedPattern: outcome.blockedPattern } : {}),
      ...(typeof outcome.durationMs === "number" ? { durationMs: outcome.durationMs } : {}),
    }];
  });
  return outcomes.length > 0 ? outcomes : undefined;
}

function readSummaryStatus(taskDir: string): SummaryStatus | undefined {
  const raw = readRegularFileBounded(join(taskDir, ".ralph-runner", "status.json"), "status.json");
  let parsed: Record<string, unknown> | undefined;
  try {
    parsed = asRecord(JSON.parse(raw));
  } catch {
    parsed = undefined;
  }
  if (!parsed || typeof parsed.status !== "string") return undefined;
  return {
    ...(typeof parsed.loopToken === "string" ? { loopToken: parsed.loopToken } : {}),
    status: parsed.status,
    currentIteration: typeof parsed.currentIteration === "number" ? parsed.currentIteration : 0,
    maxIterations: typeof parsed.maxIterations === "number" ? parsed.maxIterations : 0,
    startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : "—",
    ...(typeof parsed.completedAt === "string" ? { completedAt: parsed.completedAt } : {}),
  };
}

function readSummaryIterations(taskDir: string): SummaryIterationRecord[] {
  const raw = readRegularFileBounded(join(taskDir, ".ralph-runner", "iterations.jsonl"), "iterations.jsonl", SUMMARY_ARTIFACT_MAX_BYTES, "tail");
  return parseJsonLines(raw).flatMap((value, index): SummaryIterationRecord[] => {
    const record = asRecord(value);
    if (!record) return [];
    const iteration = typeof record.iteration === "number" ? record.iteration : index + 1;
    const status = typeof record.status === "string" ? record.status : "unknown";
    return [{
      iteration,
      status,
      ...(typeof record.startedAt === "string" ? { startedAt: record.startedAt } : {}),
      ...(typeof record.completedAt === "string" ? { completedAt: record.completedAt } : {}),
      ...(typeof record.durationMs === "number" ? { durationMs: record.durationMs } : {}),
      progress: coerceProgress(record.progress),
      changedFiles: stringArray(record.changedFiles),
      noProgressStreak: typeof record.noProgressStreak === "number" ? record.noProgressStreak : 0,
      ...(coerceCompletionGate(record.completionGate) ? { completionGate: coerceCompletionGate(record.completionGate) } : {}),
      ...(coerceCommandOutcomes(record.commandOutcomes) ? { commandOutcomes: coerceCommandOutcomes(record.commandOutcomes) } : {}),
      ...(typeof record.loopToken === "string" ? { loopToken: record.loopToken } : {}),
    }];
  });
}

function countNonEmptyLines(filePath: string): number {
  if (!existsSync(filePath)) return 0;
  let fd: number | undefined;
  try {
    const stat = lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) return 0;
    fd = openSync(filePath, "r");
    const buffer = Buffer.alloc(64 * 1024);
    let count = 0;
    let currentLineHasContent = false;
    while (true) {
      const bytesRead = readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      const chunk = buffer.toString("utf8", 0, bytesRead);
      for (const char of chunk) {
        if (char === "\n") {
          if (currentLineHasContent) count += 1;
          currentLineHasContent = false;
        } else if (!/\s/.test(char)) {
          currentLineHasContent = true;
        }
      }
    }
    if (currentLineHasContent) count += 1;
    return count;
  } catch {
    return 0;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function countEventsForLoopToken(taskDir: string, loopToken: string | undefined): number {
  const filePath = join(taskDir, ".ralph-runner", "events.jsonl");
  if (!loopToken) return countNonEmptyLines(filePath);
  if (!existsSync(filePath)) return 0;
  let fd: number | undefined;
  try {
    const stat = lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) return 0;
    fd = openSync(filePath, "r");
    const buffer = Buffer.alloc(64 * 1024);
    let currentLine = "";
    let currentLineTooLarge = false;
    let count = 0;
    const consumeLine = () => {
      if (!currentLineTooLarge && currentLine.trim().length > 0) {
        try {
          if (asRecord(JSON.parse(currentLine))?.loopToken === loopToken) count += 1;
        } catch {
          // skip malformed event lines
        }
      }
      currentLine = "";
      currentLineTooLarge = false;
    };
    while (true) {
      const bytesRead = readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      const chunk = buffer.toString("utf8", 0, bytesRead);
      for (const char of chunk) {
        if (char === "\n") {
          consumeLine();
        } else if (!currentLineTooLarge) {
          currentLine += char;
          if (currentLine.length > SUMMARY_ARTIFACT_MAX_BYTES) {
            currentLine = "";
            currentLineTooLarge = true;
          }
        }
      }
    }
    consumeLine();
    return count;
  } catch {
    return 0;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function formatDuration(ms: number | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${Math.round(ms / 1000)}s`;
}

function formatCompletionGate(record: SummaryIterationRecord | undefined): string {
  if (!record?.completionGate) return "Not checked in latest iteration.";
  if (record.completionGate.ready) return "Ready.";
  return `Blocked: ${record.completionGate.reasons.length > 0 ? record.completionGate.reasons.join("; ") : "unknown reason"}.`;
}

function formatCommandOutcomes(record: SummaryIterationRecord | undefined): string[] {
  const outcomes = record?.commandOutcomes ?? [];
  if (outcomes.length === 0) return ["No structured command outcomes recorded."];
  return outcomes.map((outcome) => {
    const details = [
      outcome.acceptance ? "acceptance" : "evidence",
      outcome.blockedPattern ? `blocked by ${outcome.blockedPattern}` : "",
      typeof outcome.durationMs === "number" ? formatDuration(outcome.durationMs) : "",
    ].filter(Boolean);
    return `- ${outcome.name}: ${outcome.status}${details.length > 0 ? ` (${details.join(", ")})` : ""}`;
  });
}

function formatRecentIterations(records: SummaryIterationRecord[], count: number): string[] {
  const recent = records.slice(-Math.max(1, count));
  if (recent.length === 0) return ["No iteration records found."];
  return recent.map((record) => {
    const changed = record.changedFiles.length > 0 ? record.changedFiles.join(", ") : "none";
    return `- #${record.iteration} ${record.status} progress=${record.progress} duration=${formatDuration(record.durationMs)} changed=${changed} noProgressStreak=${record.noProgressStreak}`;
  });
}

function formatChangedFiles(records: SummaryIterationRecord[]): string[] {
  const changed = [...new Set(records.flatMap((record) => record.changedFiles))].sort();
  if (changed.length === 0) return ["No changed files recorded."];
  return changed.map((file) => `- ${file}`);
}

function transcriptPaths(taskDir: string): string[] {
  const dir = join(taskDir, ".ralph-runner", "transcripts");
  if (!existsSync(dir)) return [];
  try {
    const stat = lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return [];
    return readdirSync(dir)
      .filter((entry) => {
        const filePath = join(dir, entry);
        try {
          const entryStat = lstatSync(filePath);
          return entryStat.isFile() && !entryStat.isSymbolicLink();
        } catch {
          return false;
        }
      })
      .sort()
      .map((entry) => join(dir, entry));
  } catch {
    return [];
  }
}

function transcriptForLatestIteration(paths: string[], latest: SummaryIterationRecord | undefined): string | undefined {
  if (paths.length === 0) return undefined;
  const iterationPrefix = latest ? `iteration-${String(latest.iteration).padStart(3, "0")}-` : undefined;
  if (latest?.loopToken) {
    const expected = `${iterationPrefix}${latest.loopToken}.md`;
    const match = paths.find((filePath) => basename(filePath) === expected);
    if (match) return match;
  }
  if (iterationPrefix) {
    const match = paths.find((filePath) => basename(filePath).startsWith(iterationPrefix));
    if (match) return match;
  }
  return paths[paths.length - 1];
}

function formatTranscriptReferences(taskDir: string, tailChars: number, latestRecord: SummaryIterationRecord | undefined, loopToken?: string): string[] {
  const allPaths = transcriptPaths(taskDir);
  if (allPaths.length === 0) return ["No transcripts found."];
  const paths = loopToken ? allPaths.filter((filePath) => basename(filePath).endsWith(`-${loopToken}.md`)) : allPaths;
  if (paths.length === 0) return ["No transcripts found for current run."];
  const latest = transcriptForLatestIteration(paths, latestRecord);
  const tailReferences = paths.filter((filePath) => filePath !== latest).slice(-(TRANSCRIPT_REFERENCE_MAX - (latest ? 1 : 0)));
  const referencePaths = [...new Set([...(latest ? [latest] : []), ...tailReferences])];
  const lines = [
    ...(paths.length > referencePaths.length ? [`Showing ${referencePaths.length} of ${paths.length} transcript references.`] : []),
    ...referencePaths.map((filePath) => `- ${filePath}`),
  ];
  if (!latest) return lines;
  const latestText = readRegularFileBounded(latest, "Latest transcript", Math.max(tailChars * 4, 4096), "tail").trimEnd();
  if (latestText) {
    lines.push("", "Latest transcript tail:", "", "```text", tailText(latestText, tailChars), "```");
  } else {
    lines.push("", "Latest transcript tail unavailable.");
  }
  return lines;
}

function taskSummaryLine(taskDir: string): string {
  const raw = readRegularFileBounded(join(taskDir, "RALPH.md"), "RALPH.md");
  const lines = raw.split("\n");
  let inFrontmatter = lines[0]?.trim() === "---";
  for (let index = inFrontmatter ? 1 : 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (inFrontmatter) {
      if (line === "---") inFrontmatter = false;
      continue;
    }
    if (line) return line;
  }
  return raw.split("\n")[0] || "RALPH.md is empty.";
}

function nextAction(status: SummaryStatus | undefined, latest: SummaryIterationRecord | undefined): string {
  if (!status) return "Inspect the task folder; no status.json was available.";
  if (status.status === "running" || status.status === "initializing") return "Monitor with /ralph-status or stop/cancel if needed.";
  if (status.status === "complete") return "Review the changed files, transcripts, and completion evidence.";
  if (latest?.completionGate && !latest.completionGate.ready) return "Address the completion gate blockers before resuming.";
  if (status.status === "max-iterations" || status.status === "no-progress-exhaustion") return "Review blockers and decide whether to edit RALPH.md or resume with a narrower task.";
  return "Review the final status and latest transcript before deciding whether to resume.";
}

export function buildRalphRunSummary(taskDir: string, options: RalphRunSummaryOptions = {}): string {
  const recentIterations = options.recentIterations ?? DEFAULT_RECENT_ITERATIONS;
  const transcriptTailChars = options.transcriptTailChars ?? DEFAULT_TRANSCRIPT_TAIL_CHARS;
  const status = readSummaryStatus(taskDir);
  const allRecords = readSummaryIterations(taskDir);
  const matchingRecords = status?.loopToken ? allRecords.filter((record) => record.loopToken === status.loopToken) : [];
  const records = status?.loopToken ? matchingRecords : allRecords;
  const eventCount = countEventsForLoopToken(taskDir, status?.loopToken);
  const latest = records[records.length - 1];

  return [
    "# Ralph Run Summary",
    "",
    "## Task",
    "",
    `- Task directory: ${taskDir}`,
    `- Name: ${basename(taskDir)}`,
    `- RALPH.md: ${taskSummaryLine(taskDir)}`,
    "",
    "## Status",
    "",
    status
      ? [`- Status: ${status.status}`, `- Iteration: ${status.currentIteration}/${status.maxIterations}`, `- Started: ${status.startedAt}`, `- Completed: ${status.completedAt ?? "—"}`].join("\n")
      : "status.json not found or unreadable.",
    "",
    "## Completion Gate",
    "",
    formatCompletionGate(latest),
    "",
    "## Latest Command Outcomes",
    "",
    ...formatCommandOutcomes(latest),
    "",
    "## Recent Iterations",
    "",
    ...formatRecentIterations(records, recentIterations),
    "",
    "## Changed Files",
    "",
    ...formatChangedFiles(records),
    "",
    "## RALPH_PROGRESS.md",
    "",
    "```markdown",
    readRegularFileBounded(join(taskDir, RALPH_PROGRESS_FILE), RALPH_PROGRESS_FILE),
    "```",
    "",
    "## Transcript References",
    "",
    ...formatTranscriptReferences(taskDir, transcriptTailChars, latest, status?.loopToken),
    "",
    "## Event Count",
    "",
    `${eventCount} non-empty event lines counted from events.jsonl.`,
    "",
    "## Next Action",
    "",
    nextAction(status, latest),
  ].join("\n");
}

export function writeRalphFinalSummary(taskDir: string): string {
  const runnerDir = join(taskDir, ".ralph-runner");
  if (existsSync(runnerDir)) {
    const stat = lstatSync(runnerDir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`Unsafe .ralph-runner directory: ${runnerDir}`);
    }
  } else {
    mkdirSync(runnerDir, { recursive: true });
  }

  const summaryPath = join(runnerDir, FINAL_SUMMARY_FILE);
  if (existsSync(summaryPath)) {
    const stat = lstatSync(summaryPath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`Unsafe final summary path: ${summaryPath}`);
    }
  }

  const tmpPath = join(runnerDir, `.${FINAL_SUMMARY_FILE}.${process.pid}.${randomUUID()}.tmp`);
  try {
    writeFileSync(tmpPath, buildRalphRunSummary(taskDir), { encoding: "utf8", flag: "wx" });
    renameSync(tmpPath, summaryPath);
  } catch (err) {
    rmSync(tmpPath, { force: true });
    throw err;
  }
  return summaryPath;
}
