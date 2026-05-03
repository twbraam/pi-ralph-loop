import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildRalphRunSummary, writeRalphFinalSummary } from "../src/runner-summary.ts";
import { appendIterationRecord, appendRunnerEvent, writeIterationTranscript, writeStatusFile } from "../src/runner-state.ts";

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "pi-ralph-summary-"));
}

test("buildRalphRunSummary summarizes durable Ralph artifacts deterministically", () => {
  const taskDir = createTempDir();
  try {
    mkdirSync(join(taskDir, ".ralph-runner"), { recursive: true });
    writeFileSync(join(taskDir, "RALPH.md"), "---\nmax_iterations: 3\ntimeout: 120\ncommands: []\n---\n# Task\n", "utf8");
    writeFileSync(join(taskDir, "RALPH_PROGRESS.md"), "- fixed parser\n", "utf8");
    writeStatusFile(taskDir, {
      loopToken: "loop-a",
      ralphPath: join(taskDir, "RALPH.md"),
      taskDir,
      cwd: taskDir,
      status: "complete",
      currentIteration: 2,
      maxIterations: 3,
      timeout: 120,
      startedAt: "2026-05-03T10:00:00.000Z",
      completedAt: "2026-05-03T10:05:00.000Z",
      guardrails: { blockCommands: [], protectedFiles: [] },
    });
    appendIterationRecord(taskDir, {
      iteration: 2,
      status: "complete",
      startedAt: "2026-05-03T10:04:00.000Z",
      completedAt: "2026-05-03T10:05:00.000Z",
      durationMs: 60000,
      progress: true,
      changedFiles: ["src/parser.ts"],
      noProgressStreak: 0,
      completionGate: { ready: false, reasons: ["OPEN_QUESTIONS.md still has P0 items"] },
      loopToken: "loop-a",
    });
    appendRunnerEvent(taskDir, {
      type: "runner.finished",
      timestamp: "2026-05-03T10:05:00.000Z",
      loopToken: "loop-a",
      status: "complete",
      iterations: 2,
      totalDurationMs: 300000,
    });
    writeIterationTranscript(taskDir, {
      record: {
        iteration: 2,
        status: "complete",
        startedAt: "2026-05-03T10:04:00.000Z",
        completedAt: "2026-05-03T10:05:00.000Z",
        durationMs: 60000,
        progress: true,
        changedFiles: ["src/parser.ts"],
        noProgressStreak: 0,
        loopToken: "loop-a",
      },
      prompt: "prompt",
      commandOutputs: [],
      assistantText: "assistant result",
    });

    const summary = buildRalphRunSummary(taskDir, { transcriptTailChars: 200 });

    assert.match(summary, /^# Ralph Run Summary/);
    assert.match(summary, /RALPH\.md: # Task/);
    assert.doesNotMatch(summary, /RALPH\.md: ---/);
    assert.match(summary, /Status: complete/);
    assert.match(summary, /Blocked: OPEN_QUESTIONS\.md still has P0 items\./);
    assert.match(summary, /No structured command outcomes recorded/);
    assert.match(summary, /- #2 complete progress=true duration=60s changed=src\/parser\.ts noProgressStreak=0/);
    assert.match(summary, /- src\/parser\.ts/);
    assert.match(summary, /- fixed parser/);
    assert.match(summary, /Latest transcript tail:/);
    assert.match(summary, /1 non-empty event lines counted/);
    assert.match(summary, /Review the changed files, transcripts, and completion evidence\./);
  } finally {
    rmSync(taskDir, { recursive: true, force: true });
  }
});

test("buildRalphRunSummary filters stale artifacts to current loop token", () => {
  const taskDir = createTempDir();
  try {
    mkdirSync(join(taskDir, ".ralph-runner", "transcripts"), { recursive: true });
    writeStatusFile(taskDir, {
      loopToken: "current-loop",
      ralphPath: join(taskDir, "RALPH.md"),
      taskDir,
      cwd: taskDir,
      status: "complete",
      currentIteration: 1,
      maxIterations: 1,
      timeout: 120,
      startedAt: "2026-05-03T10:00:00.000Z",
      completedAt: "2026-05-03T10:01:00.000Z",
      guardrails: { blockCommands: [], protectedFiles: [] },
    });
    appendIterationRecord(taskDir, {
      iteration: 9,
      status: "complete",
      startedAt: "2026-05-03T09:00:00.000Z",
      completedAt: "2026-05-03T09:01:00.000Z",
      durationMs: 60000,
      progress: true,
      changedFiles: ["old.md"],
      noProgressStreak: 0,
      loopToken: "old-loop",
    });
    appendIterationRecord(taskDir, {
      iteration: 1,
      status: "complete",
      startedAt: "2026-05-03T10:00:00.000Z",
      completedAt: "2026-05-03T10:01:00.000Z",
      durationMs: 60000,
      progress: true,
      changedFiles: ["current.md"],
      noProgressStreak: 0,
      loopToken: "current-loop",
    });
    appendRunnerEvent(taskDir, { type: "runner.finished", timestamp: "2026-05-03T09:01:00.000Z", loopToken: "old-loop", status: "complete", iterations: 9, totalDurationMs: 60000 });
    appendRunnerEvent(taskDir, { type: "runner.finished", timestamp: "2026-05-03T10:01:00.000Z", loopToken: "current-loop", status: "complete", iterations: 1, totalDurationMs: 60000 });
    writeFileSync(join(taskDir, ".ralph-runner", "transcripts", "iteration-009-old-loop.md"), "old transcript", "utf8");
    writeFileSync(join(taskDir, ".ralph-runner", "transcripts", "iteration-001-current-loop.md"), "current transcript", "utf8");

    const summary = buildRalphRunSummary(taskDir);

    assert.match(summary, /current\.md/);
    assert.doesNotMatch(summary, /old\.md/);
    assert.match(summary, /current transcript/);
    assert.doesNotMatch(summary, /old transcript\n```/);
    assert.match(summary, /1 non-empty event lines counted/);
  } finally {
    rmSync(taskDir, { recursive: true, force: true });
  }
});

test("buildRalphRunSummary does not fall back to stale artifacts when current loop has no records yet", () => {
  const taskDir = createTempDir();
  try {
    mkdirSync(join(taskDir, ".ralph-runner", "transcripts"), { recursive: true });
    writeStatusFile(taskDir, {
      loopToken: "current-loop",
      ralphPath: join(taskDir, "RALPH.md"),
      taskDir,
      cwd: taskDir,
      status: "running",
      currentIteration: 0,
      maxIterations: 3,
      timeout: 120,
      startedAt: "2026-05-03T10:00:00.000Z",
      guardrails: { blockCommands: [], protectedFiles: [] },
    });
    appendIterationRecord(taskDir, {
      iteration: 9,
      status: "complete",
      startedAt: "2026-05-03T09:00:00.000Z",
      completedAt: "2026-05-03T09:01:00.000Z",
      durationMs: 60000,
      progress: true,
      changedFiles: ["old.md"],
      noProgressStreak: 0,
      loopToken: "old-loop",
    });
    writeFileSync(join(taskDir, ".ralph-runner", "transcripts", "iteration-009-old-loop.md"), "old transcript", "utf8");

    const summary = buildRalphRunSummary(taskDir);

    assert.match(summary, /No iteration records found\./);
    assert.match(summary, /No transcripts found for current run\./);
    assert.doesNotMatch(summary, /old\.md/);
    assert.doesNotMatch(summary, /iteration-009-old-loop\.md/);
    assert.doesNotMatch(summary, /old transcript/);
  } finally {
    rmSync(taskDir, { recursive: true, force: true });
  }
});

test("buildRalphRunSummary caps transcript references", () => {
  const taskDir = createTempDir();
  try {
    mkdirSync(join(taskDir, ".ralph-runner", "transcripts"), { recursive: true });
    appendIterationRecord(taskDir, {
      iteration: 25,
      status: "complete",
      startedAt: "2026-05-03T10:00:00.000Z",
      completedAt: "2026-05-03T10:01:00.000Z",
      durationMs: 60000,
      progress: true,
      changedFiles: ["latest.md"],
      noProgressStreak: 0,
      loopToken: "loop-a",
    });
    for (let index = 1; index <= 25; index += 1) {
      writeFileSync(join(taskDir, ".ralph-runner", "transcripts", `iteration-${String(index).padStart(3, "0")}-loop-a.md`), `transcript ${index}`, "utf8");
    }

    const summary = buildRalphRunSummary(taskDir);

    assert.match(summary, /Showing 20 of 25 transcript references/);
    assert.match(summary, /iteration-025-loop-a\.md/);
    assert.doesNotMatch(summary, /iteration-001-loop-a\.md/);
    const transcriptReferenceCount = summary.split("\n").filter((line) => /^- .*iteration-\d{3}-loop-a\.md$/.test(line)).length;
    assert.equal(transcriptReferenceCount, 20);
  } finally {
    rmSync(taskDir, { recursive: true, force: true });
  }
});

test("buildRalphRunSummary uses tail records for large iteration JSONL", () => {
  const taskDir = createTempDir();
  try {
    mkdirSync(join(taskDir, ".ralph-runner", "transcripts"), { recursive: true });
    const oldRecords = Array.from({ length: 400 }, (_, index) => JSON.stringify({
      iteration: index + 1,
      status: "complete",
      progress: true,
      changedFiles: [`old-${index}.md`],
      noProgressStreak: 0,
      padding: "x".repeat(900),
    })).join("\n");
    const latest = JSON.stringify({
      iteration: 401,
      status: "complete",
      progress: true,
      changedFiles: ["latest.md"],
      noProgressStreak: 0,
      completionGate: { ready: true, reasons: [] },
      loopToken: "latest-loop",
    });
    writeFileSync(join(taskDir, ".ralph-runner", "iterations.jsonl"), `${oldRecords}\n${latest}\n`, "utf8");
    writeFileSync(join(taskDir, ".ralph-runner", "transcripts", "iteration-401-latest-loop.md"), "latest transcript", "utf8");
    writeFileSync(join(taskDir, ".ralph-runner", "events.jsonl"), Array.from({ length: 10 }, (_, index) => JSON.stringify({ type: "event", index })).join("\n") + "\n", "utf8");

    const summary = buildRalphRunSummary(taskDir);

    assert.match(summary, /#401 complete progress=true/);
    assert.match(summary, /latest\.md/);
    assert.match(summary, /latest transcript/);
    assert.match(summary, /10 non-empty event lines counted/);
    assert.doesNotMatch(summary, /old-0\.md/);
  } finally {
    rmSync(taskDir, { recursive: true, force: true });
  }
});

test("buildRalphRunSummary tolerates schema-invalid iteration JSONL", () => {
  const taskDir = createTempDir();
  try {
    mkdirSync(join(taskDir, ".ralph-runner"), { recursive: true });
    writeFileSync(join(taskDir, ".ralph-runner", "iterations.jsonl"), "{\"iteration\":1}\n{}\n", "utf8");

    const summary = buildRalphRunSummary(taskDir);

    assert.match(summary, /#1 unknown progress=unknown/);
    assert.match(summary, /#2 unknown progress=unknown/);
  } finally {
    rmSync(taskDir, { recursive: true, force: true });
  }
});

test("buildRalphRunSummary ignores symlinked status and JSONL artifacts", () => {
  const taskDir = createTempDir();
  const outside = createTempDir();
  try {
    mkdirSync(join(taskDir, ".ralph-runner"), { recursive: true });
    writeFileSync(join(outside, "status.json"), JSON.stringify({ status: "complete", currentIteration: 99, maxIterations: 99, startedAt: "leak" }), "utf8");
    writeFileSync(join(outside, "iterations.jsonl"), "{\"iteration\":99,\"status\":\"complete\",\"changedFiles\":[\"secret\"]}\n", "utf8");
    symlinkSync(join(outside, "status.json"), join(taskDir, ".ralph-runner", "status.json"));
    symlinkSync(join(outside, "iterations.jsonl"), join(taskDir, ".ralph-runner", "iterations.jsonl"));

    const summary = buildRalphRunSummary(taskDir);

    assert.match(summary, /status\.json not found or unreadable/);
    assert.match(summary, /No iteration records found/);
    assert.doesNotMatch(summary, /secret/);
  } finally {
    rmSync(taskDir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("buildRalphRunSummary chooses transcript by iteration prefix without loop token", () => {
  const taskDir = createTempDir();
  try {
    mkdirSync(join(taskDir, ".ralph-runner", "transcripts"), { recursive: true });
    appendIterationRecord(taskDir, {
      iteration: 1,
      status: "complete",
      startedAt: "2026-05-03T10:00:00.000Z",
      completedAt: "2026-05-03T10:01:00.000Z",
      durationMs: 60000,
      progress: true,
      changedFiles: ["latest.md"],
      noProgressStreak: 0,
    });
    writeFileSync(join(taskDir, ".ralph-runner", "transcripts", "iteration-009-old-loop.md"), "old transcript", "utf8");
    writeFileSync(join(taskDir, ".ralph-runner", "transcripts", "iteration-001-new-loop.md"), "new transcript", "utf8");

    const summary = buildRalphRunSummary(taskDir);

    assert.match(summary, /new transcript/);
    assert.doesNotMatch(summary, /old transcript\n```/);
  } finally {
    rmSync(taskDir, { recursive: true, force: true });
  }
});

test("buildRalphRunSummary chooses the transcript for the latest iteration record", () => {
  const taskDir = createTempDir();
  try {
    mkdirSync(join(taskDir, ".ralph-runner", "transcripts"), { recursive: true });
    appendIterationRecord(taskDir, {
      iteration: 1,
      status: "complete",
      startedAt: "2026-05-03T10:00:00.000Z",
      completedAt: "2026-05-03T10:01:00.000Z",
      durationMs: 60000,
      progress: true,
      changedFiles: ["latest.md"],
      noProgressStreak: 0,
      loopToken: "new-loop",
    });
    writeFileSync(join(taskDir, ".ralph-runner", "transcripts", "iteration-009-old-loop.md"), "old transcript", "utf8");
    writeFileSync(join(taskDir, ".ralph-runner", "transcripts", "iteration-001-new-loop.md"), "new transcript", "utf8");

    const summary = buildRalphRunSummary(taskDir);

    assert.match(summary, /new transcript/);
    assert.doesNotMatch(summary, /old transcript\n```/);
  } finally {
    rmSync(taskDir, { recursive: true, force: true });
  }
});

test("writeRalphFinalSummary refuses symlinked final-summary destinations", () => {
  const taskDir = createTempDir();
  const outside = createTempDir();
  try {
    mkdirSync(join(taskDir, ".ralph-runner"), { recursive: true });
    const outsideFile = join(outside, "outside.md");
    writeFileSync(outsideFile, "do not overwrite", "utf8");
    symlinkSync(outsideFile, join(taskDir, ".ralph-runner", "final-summary.md"));

    assert.throws(() => writeRalphFinalSummary(taskDir), /Unsafe final summary path/);
    assert.equal(readFileSync(outsideFile, "utf8"), "do not overwrite");
  } finally {
    rmSync(taskDir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("buildRalphRunSummary reports missing artifacts without throwing", () => {
  const taskDir = createTempDir();
  try {
    const summary = buildRalphRunSummary(taskDir);

    assert.match(summary, /status\.json not found or unreadable/);
    assert.match(summary, /No iteration records found/);
    assert.match(summary, /RALPH_PROGRESS\.md not found/);
    assert.match(summary, /No transcripts found/);
  } finally {
    rmSync(taskDir, { recursive: true, force: true });
  }
});

test("buildRalphRunSummary ignores symlinked transcripts", () => {
  const taskDir = createTempDir();
  const outside = createTempDir();
  try {
    mkdirSync(join(taskDir, ".ralph-runner"), { recursive: true });
    writeFileSync(join(outside, "secret.md"), "secret", "utf8");
    symlinkSync(outside, join(taskDir, ".ralph-runner", "transcripts"), "dir");

    const summary = buildRalphRunSummary(taskDir);

    assert.match(summary, /No transcripts found/);
    assert.doesNotMatch(summary, /secret/);
  } finally {
    rmSync(taskDir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("writeRalphFinalSummary writes final-summary.md in the runner directory", () => {
  const taskDir = createTempDir();
  try {
    mkdirSync(join(taskDir, ".ralph-runner"), { recursive: true });

    const summaryPath = writeRalphFinalSummary(taskDir);

    assert.equal(summaryPath, join(taskDir, ".ralph-runner", "final-summary.md"));
    assert.equal(existsSync(summaryPath), true);
    assert.match(readFileSync(summaryPath, "utf8"), /^# Ralph Run Summary/);
  } finally {
    rmSync(taskDir, { recursive: true, force: true });
  }
});
