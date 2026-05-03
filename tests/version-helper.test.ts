import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const scriptPath = fileURLToPath(new URL("../scripts/version-helper.ts", import.meta.url));

function runVersionHelper(
  branch: "main" | "dev",
  bump: "major" | "minor" | "patch" | "none",
  npmVersions: string[] | string,
  gitTags: string[] | string,
  currentVersion?: string,
): string {
  const args = ["--experimental-strip-types", scriptPath, branch, bump, encodeInput(npmVersions), encodeInput(gitTags)];
  if (currentVersion) args.push(currentVersion);
  const result = spawnSync(
    process.execPath,
    args,
    { encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function encodeInput(input: string[] | string): string {
  return Array.isArray(input) ? JSON.stringify(input) : input;
}

test("highest stable npm beats stale package line assumptions", () => {
  assert.equal(
    runVersionHelper(
      "main",
      "patch",
      ["0.1.4-dev.1", "1.1.9", "1.2.3", "1.2.3-dev.0"],
      ["v1.1.9", "v1.2.3"],
    ),
    "1.2.4",
  );
});

test("highest stable git tag beats stale package line assumptions", () => {
  assert.equal(
    runVersionHelper(
      "main",
      "patch",
      ["0.1.4-dev.1", "1.1.9", "1.2.5"],
      ["v1.1.9", "v1.2.5", "v1.2.4-dev.0"],
    ),
    "1.2.6",
  );
});

test("before any stable >= 1.0.0 exists, the next stable floors to 1.0.0", () => {
  assert.equal(runVersionHelper("main", "patch", ["0.9.9"], ["v0.9.9"]), "1.0.0");
});

test("main returns exact 1.0.0 in the current-style stale prerelease scenario", () => {
  assert.equal(
    runVersionHelper("main", "patch", ["0.1.4-dev.1", "1.0.0-dev.0"], ["v0.1.4-dev.1"]),
    "1.0.0",
  );
});

test("dev returns the next dev prerelease after the highest prior prerelease", () => {
  assert.equal(
    runVersionHelper("dev", "patch", "0.1.4-dev.1\n1.0.0-dev.0", ["v0.1.4-dev.1", "v1.0.0-dev.0"]),
    "1.0.0-dev.1",
  );
  assert.equal(
    runVersionHelper("dev", "patch", ["1.0.0-dev.0", "1.0.0-dev.2"], ["v0.9.9", "v1.0.0-dev.0", "v1.0.0-dev.2"]),
    "1.0.0-dev.3",
  );
});

test("once 1.0.0 exists, bumping resumes normally from the highest stable version", () => {
  assert.equal(
    runVersionHelper("main", "patch", ["1.0.0", "1.1.9", "1.2.3"], ["v1.0.0", "v1.1.9", "v1.2.3"]),
    "1.2.4",
  );
});

test("main respects an unpublished pre-bumped package version above the computed version", () => {
  assert.equal(
    runVersionHelper("main", "patch", ["1.5.2"], ["v1.5.2"], "1.8.0"),
    "1.8.0",
  );
});

test("main ignores a stale, fully released, or prerelease package version", () => {
  assert.equal(
    runVersionHelper("main", "minor", ["1.5.2"], ["v1.5.2"], "1.5.2"),
    "1.6.0",
  );
  assert.equal(
    runVersionHelper("main", "patch", ["1.8.0"], ["v1.8.0"], "1.8.0"),
    "1.8.1",
  );
  assert.equal(
    runVersionHelper("main", "patch", ["1.5.2"], ["v1.5.2"], "1.8.0-dev.0"),
    "1.5.3",
  );
});

test("main reuses the highest incomplete stable release before fresh version calculation", () => {
  assert.equal(
    runVersionHelper("main", "minor", ["1.5.2", "1.6.0"], ["v1.5.2"]),
    "1.6.0",
  );
  assert.equal(
    runVersionHelper("main", "minor", ["1.5.2"], ["v1.5.2", "v1.6.0"]),
    "1.6.0",
  );
  assert.equal(
    runVersionHelper("main", "none", ["1.5.2", "1.6.0", "1.7.0"], ["v1.5.2", "v1.6.0"]),
    "1.7.0",
  );
});

test("dev turns an unpublished pre-bumped stable package version into a dev prerelease", () => {
  assert.equal(
    runVersionHelper("dev", "patch", ["1.5.2"], ["v1.5.2"], "1.8.0"),
    "1.8.0-dev.0",
  );
  assert.equal(
    runVersionHelper("dev", "patch", ["1.5.2", "1.8.0-dev.0"], ["v1.5.2", "v1.8.0-dev.0"], "1.8.0"),
    "1.8.0-dev.1",
  );
});

test("dev advances from the highest fully released dev prerelease", () => {
  assert.equal(
    runVersionHelper("dev", "patch", ["1.5.2", "1.8.0-dev.4"], ["v1.5.2", "v1.8.0-dev.4"], "1.8.0-dev.4"),
    "1.8.0-dev.5",
  );
});

test("dev may respect an unpublished or partially released pre-bumped dev prerelease but not a stable published version", () => {
  assert.equal(
    runVersionHelper("dev", "patch", ["1.5.2"], ["v1.5.2"], "1.8.0-dev.4"),
    "1.8.0-dev.4",
  );
  assert.equal(
    runVersionHelper("dev", "patch", ["1.5.2", "1.8.0-dev.4"], ["v1.5.2"], "1.8.0-dev.4"),
    "1.8.0-dev.4",
  );
  assert.equal(
    runVersionHelper("dev", "none", ["1.5.2"], ["v1.5.2", "v1.8.0-dev.4"]),
    "1.8.0-dev.4",
  );
  assert.equal(
    runVersionHelper("dev", "patch", ["1.8.0"], ["v1.8.0"], "1.8.0"),
    "1.8.1-dev.0",
  );
});

test("none returns no version when there is no incomplete release to repair", () => {
  assert.equal(runVersionHelper("main", "none", ["1.5.2"], ["v1.5.2"]), "");
  assert.equal(runVersionHelper("dev", "none", ["1.5.2"], ["v1.5.2"]), "");
});
