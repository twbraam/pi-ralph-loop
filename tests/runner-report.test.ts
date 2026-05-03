import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { generateStaticRunnerReport } from "../src/runner-report.ts";

test("generateStaticRunnerReport writes escaped static HTML from copied artifacts", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ralph-report-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  writeFileSync(join(dir, "status.json"), JSON.stringify({ status: "done", summary: "<done>" }), "utf8");
  writeFileSync(join(dir, "iterations.jsonl"), JSON.stringify({ iteration: 1, summary: "<script>alert(1)</script>", progress: true }) + "\n", "utf8");
  writeFileSync(join(dir, "events.jsonl"), JSON.stringify({ type: "note", message: "use <b>bold</b>" }) + "\n", "utf8");

  const result = generateStaticRunnerReport(dir);

  assert.equal(result.iterations, 1);
  assert.equal(result.events, 1);
  assert.equal(result.reportPath, join(dir, "report.html"));
  assert.equal(existsSync(result.reportPath), true);
  const html = readFileSync(result.reportPath, "utf8");
  assert.match(html, /Ralph Run Report/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /use &lt;b&gt;bold&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
});

test("generateStaticRunnerReport escapes summary and message list labels", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ralph-report-labels-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  writeFileSync(join(dir, "iterations.jsonl"), JSON.stringify({ summary: "<img src=x onerror=alert(1)>" }) + "\n", "utf8");
  writeFileSync(join(dir, "events.jsonl"), JSON.stringify({ message: "<svg onload=alert(1)>" }) + "\n", "utf8");

  const result = generateStaticRunnerReport(dir);
  const html = readFileSync(result.reportPath, "utf8");

  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&lt;svg onload=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img src=x onerror=alert\(1\)>/);
  assert.doesNotMatch(html, /<svg onload=alert\(1\)>/);
});

test("generateStaticRunnerReport rejects symlinked artifact directories", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ralph-report-symlink-dir-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const target = join(dir, "target");
  mkdirSync(target);
  symlinkSync(target, join(dir, "linked"), "dir");

  assert.throws(() => generateStaticRunnerReport(join(dir, "linked")), /Unsafe artifactsDir path segment|artifactsDir must be a regular directory/);
});

test("generateStaticRunnerReport rejects artifact directories reached through symlinked parents", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ralph-report-symlink-parent-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const outside = join(dir, "outside");
  mkdirSync(join(outside, "artifacts"), { recursive: true });
  symlinkSync(outside, join(dir, "linked-parent"), "dir");

  assert.throws(() => generateStaticRunnerReport(join(dir, "linked-parent", "artifacts")), /Unsafe artifactsDir path segment/);
  assert.equal(existsSync(join(outside, "artifacts", "report.html")), false);
});

test("generateStaticRunnerReport skips symlinked copied artifacts", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ralph-report-symlink-artifact-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  writeFileSync(join(dir, "secret-status.json"), JSON.stringify({ secret: "leak" }), "utf8");
  symlinkSync(join(dir, "secret-status.json"), join(dir, "status.json"));

  const result = generateStaticRunnerReport(dir);
  const html = readFileSync(result.reportPath, "utf8");

  assert.match(html, /No status\.json exported\./);
  assert.doesNotMatch(html, /leak/);
});

test("generateStaticRunnerReport refuses to overwrite symlinked report files", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ralph-report-symlink-output-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const target = join(dir, "outside.html");
  writeFileSync(target, "do not overwrite", "utf8");
  symlinkSync(target, join(dir, "report.html"));

  assert.throws(() => generateStaticRunnerReport(dir), /EEXIST/);
  assert.equal(readFileSync(target, "utf8"), "do not overwrite");
});

test("generateStaticRunnerReport rejects path-like report names", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ralph-report-name-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  assert.throws(() => generateStaticRunnerReport(dir, "../report.html"), /basename-only/);
  assert.throws(() => generateStaticRunnerReport(dir, "."), /basename-only/);
  assert.throws(() => generateStaticRunnerReport(dir, ".."), /basename-only/);
  assert.equal(existsSync(join(dir, "..", "report.html")), false);
});
