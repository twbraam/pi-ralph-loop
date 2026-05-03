import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
