import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type VersionBump = "major" | "minor" | "patch" | "none";
export type ReleaseBranch = "main" | "dev";

export interface ReleaseVersionRequest {
  branch: ReleaseBranch;
  bump: VersionBump;
  npmVersions: readonly string[] | string;
  gitTags: readonly string[] | string;
  currentVersion?: string;
}

type ParsedVersion = {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
};

const STABLE_VERSION = /^\d+\.\d+\.\d+$/;
const SEMVER_VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
const DEV_PRERELEASE = /^dev\.(\d+)$/;

function normalizeVersionList(input: readonly string[] | string): string[] {
  if (Array.isArray(input)) {
    return input.map((version) => version.trim()).filter(Boolean);
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map((value) => String(value).trim()).filter(Boolean);
    }

    if (typeof parsed === "string") {
      return parsed.trim() ? [parsed.trim()] : [];
    }
  } catch {
    // Fall through to line-based parsing.
  }

  return trimmed
    .split(/[\r\n,]+/)
    .map((version) => version.trim())
    .filter(Boolean);
}

function stripGitTagPrefix(version: string): string {
  return version.startsWith("v") ? version.slice(1) : version;
}

function parseVersion(version: string): ParsedVersion | null {
  const match = version.match(SEMVER_VERSION);
  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4],
  };
}

function isStableVersion(version: string): boolean {
  return STABLE_VERSION.test(version);
}

function comparePrerelease(left: string | undefined, right: string | undefined): number {
  if (left === right) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;

  const leftParts = left.split(".");
  const rightParts = right.split(".");
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;

    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) {
      return Number(leftPart) - Number(rightPart);
    }
    if (leftNumeric) return -1;
    if (rightNumeric) return 1;
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

function compareVersions(left: string, right: string): number {
  const leftParsed = parseVersion(left);
  const rightParsed = parseVersion(right);

  if (!leftParsed || !rightParsed) {
    return 0;
  }

  if (leftParsed.major !== rightParsed.major) {
    return leftParsed.major - rightParsed.major;
  }

  if (leftParsed.minor !== rightParsed.minor) {
    return leftParsed.minor - rightParsed.minor;
  }

  if (leftParsed.patch !== rightParsed.patch) {
    return leftParsed.patch - rightParsed.patch;
  }

  return comparePrerelease(leftParsed.prerelease, rightParsed.prerelease);
}

function maxVersion(versions: string[]): string | null {
  return versions.reduce<string | null>((currentMax, version) => {
    if (!currentMax) {
      return version;
    }

    return compareVersions(version, currentMax) > 0 ? version : currentMax;
  }, null);
}

function incStable(version: string, bump: VersionBump): string {
  const parsed = parseVersion(version);
  if (!parsed) {
    throw new Error(`Unsupported version: ${version}`);
  }

  if (bump === "major") {
    return `${parsed.major + 1}.0.0`;
  }

  if (bump === "minor") {
    return `${parsed.major}.${parsed.minor + 1}.0`;
  }

  return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
}

function collectStableVersions(input: readonly string[] | string): string[] {
  return normalizeVersionList(input)
    .map(stripGitTagPrefix)
    .filter(isStableVersion);
}

function highestStableVersion(npmVersions: readonly string[] | string, gitTags: readonly string[] | string): string {
  const stableNpm = collectStableVersions(npmVersions);
  const stableTags = collectStableVersions(gitTags);
  const highest = maxVersion([...stableNpm, ...stableTags]);
  return highest ?? "0.0.0";
}

function stableReleaseExistsAtOrAboveOne(npmVersions: readonly string[] | string, gitTags: readonly string[] | string): boolean {
  return [...collectStableVersions(npmVersions), ...collectStableVersions(gitTags)].some(
    (version) => compareVersions(version, "1.0.0") >= 0,
  );
}

function nextPrereleaseNumber(targetStable: string, npmVersions: readonly string[] | string, gitTags: readonly string[] | string): number {
  let max = -1;

  for (const rawVersion of [...normalizeVersionList(npmVersions), ...normalizeVersionList(gitTags)]) {
    const version = stripGitTagPrefix(rawVersion);
    const parsed = parseVersion(version);
    if (!parsed || `${parsed.major}.${parsed.minor}.${parsed.patch}` !== targetStable) {
      continue;
    }

    const prerelease = parsed.prerelease;
    if (!prerelease) {
      continue;
    }

    const match = prerelease.match(DEV_PRERELEASE);
    if (!match) {
      continue;
    }

    max = Math.max(max, Number(match[1]));
  }

  return max + 1;
}

function normalizedNpmVersions(npmVersions: readonly string[] | string): string[] {
  return normalizeVersionList(npmVersions).map(stripGitTagPrefix);
}

function normalizedGitTags(gitTags: readonly string[] | string): string[] {
  return normalizeVersionList(gitTags).map(stripGitTagPrefix);
}

function hasNpmVersion(version: string, npmVersions: readonly string[] | string): boolean {
  const normalized = stripGitTagPrefix(version.trim());
  return normalizedNpmVersions(npmVersions).includes(normalized);
}

function hasGitTag(version: string, gitTags: readonly string[] | string): boolean {
  const normalized = stripGitTagPrefix(version.trim());
  return normalizedGitTags(gitTags).includes(normalized);
}

function releasePresence(version: string, npmVersions: readonly string[] | string, gitTags: readonly string[] | string): { npm: boolean; git: boolean } {
  return {
    npm: hasNpmVersion(version, npmVersions),
    git: hasGitTag(version, gitTags),
  };
}

function isIncompleteRelease(version: string, npmVersions: readonly string[] | string, gitTags: readonly string[] | string): boolean {
  const presence = releasePresence(version, npmVersions, gitTags);
  return presence.npm !== presence.git;
}

function isCompletelyReleased(version: string, npmVersions: readonly string[] | string, gitTags: readonly string[] | string): boolean {
  const presence = releasePresence(version, npmVersions, gitTags);
  return presence.npm && presence.git;
}

function stablePart(version: ParsedVersion): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}

function devPrereleaseVersion(targetStable: string, npmVersions: readonly string[] | string, gitTags: readonly string[] | string): string {
  return `${targetStable}-dev.${nextPrereleaseNumber(targetStable, npmVersions, gitTags)}`;
}

function highestDevStableBase(npmVersions: readonly string[] | string, gitTags: readonly string[] | string): string | null {
  const bases = [...normalizedNpmVersions(npmVersions), ...normalizedGitTags(gitTags)].flatMap((version) => {
    const parsed = parseVersion(version);
    if (!parsed?.prerelease || !DEV_PRERELEASE.test(parsed.prerelease)) return [];
    return [stablePart(parsed)];
  });
  return maxVersion(bases);
}

function maxStableBase(...versions: Array<string | null | undefined>): string | null {
  return maxVersion(versions.filter((version): version is string => Boolean(version)));
}

function incompleteReleaseCandidates(branch: ReleaseBranch, npmVersions: readonly string[] | string, gitTags: readonly string[] | string): string[] {
  const npmSet = new Set(normalizedNpmVersions(npmVersions));
  const gitSet = new Set(normalizedGitTags(gitTags));
  const allVersions = new Set([...npmSet, ...gitSet]);
  return [...allVersions].filter((version) => {
    const parsed = parseVersion(version);
    if (!parsed) return false;
    if ((npmSet.has(version) && gitSet.has(version)) || (!npmSet.has(version) && !gitSet.has(version))) return false;
    if (branch === "main") return parsed.prerelease === undefined;
    return parsed.prerelease !== undefined && DEV_PRERELEASE.test(parsed.prerelease);
  });
}

function completeReleaseVersions(branch: ReleaseBranch, npmVersions: readonly string[] | string, gitTags: readonly string[] | string): string[] {
  const npmSet = new Set(normalizedNpmVersions(npmVersions));
  const gitSet = new Set(normalizedGitTags(gitTags));
  return [...npmSet].filter((version) => {
    if (!gitSet.has(version)) return false;
    const parsed = parseVersion(version);
    if (!parsed) return false;
    if (branch === "main") return parsed.prerelease === undefined;
    return parsed.prerelease !== undefined && DEV_PRERELEASE.test(parsed.prerelease);
  });
}

function highestIncompleteReleaseVersion(branch: ReleaseBranch, npmVersions: readonly string[] | string, gitTags: readonly string[] | string): string | null {
  const highestComplete = maxVersion(completeReleaseVersions(branch, npmVersions, gitTags));
  const candidates = incompleteReleaseCandidates(branch, npmVersions, gitTags).filter(
    (version) => !highestComplete || compareVersions(version, highestComplete) > 0,
  );
  return maxVersion(candidates);
}

export function computeReleaseVersion({ branch, bump, npmVersions, gitTags, currentVersion }: ReleaseVersionRequest): string {
  const incompleteVersion = highestIncompleteReleaseVersion(branch, npmVersions, gitTags);
  if (incompleteVersion) return incompleteVersion;
  if (bump === "none") return "";

  const baseStable = highestStableVersion(npmVersions, gitTags);
  let targetStable = incStable(baseStable, bump);

  if (!stableReleaseExistsAtOrAboveOne(npmVersions, gitTags)) {
    targetStable = compareVersions(targetStable, "1.0.0") < 0 ? "1.0.0" : targetStable;
  }

  const normalizedCurrent = currentVersion ? stripGitTagPrefix(currentVersion.trim()) : undefined;
  const currentParsed = normalizedCurrent ? parseVersion(normalizedCurrent) : null;

  if (branch === "main") {
    if (normalizedCurrent && currentParsed && !currentParsed.prerelease) {
      if (isIncompleteRelease(normalizedCurrent, npmVersions, gitTags)) {
        return normalizedCurrent;
      }
      if (!isCompletelyReleased(normalizedCurrent, npmVersions, gitTags) && compareVersions(normalizedCurrent, targetStable) > 0) {
        return normalizedCurrent;
      }
    }
    return targetStable;
  }

  const currentStable = currentParsed ? stablePart(currentParsed) : null;
  const currentDevStable = currentParsed?.prerelease && DEV_PRERELEASE.test(currentParsed.prerelease) ? currentStable : null;
  const devTargetStable = maxStableBase(targetStable, highestDevStableBase(npmVersions, gitTags), currentDevStable) ?? targetStable;
  const computedDevVersion = devPrereleaseVersion(devTargetStable, npmVersions, gitTags);
  if (!normalizedCurrent || !currentParsed) {
    return computedDevVersion;
  }

  if (!currentParsed.prerelease) {
    return !isCompletelyReleased(currentStable, npmVersions, gitTags) && compareVersions(currentStable, devTargetStable) > 0
      ? devPrereleaseVersion(currentStable, npmVersions, gitTags)
      : computedDevVersion;
  }

  if (!DEV_PRERELEASE.test(currentParsed.prerelease)) {
    return computedDevVersion;
  }

  if (isIncompleteRelease(normalizedCurrent, npmVersions, gitTags)) {
    return normalizedCurrent;
  }

  if (!isCompletelyReleased(normalizedCurrent, npmVersions, gitTags) && compareVersions(normalizedCurrent, computedDevVersion) > 0) {
    return normalizedCurrent;
  }

  return computedDevVersion;
}

export const nextReleaseVersion = computeReleaseVersion;

function isReleaseBranch(value: string): value is ReleaseBranch {
  return value === "main" || value === "dev";
}

function isVersionBump(value: string): value is VersionBump {
  return value === "major" || value === "minor" || value === "patch" || value === "none";
}

function main(argv: string[]): void {
  const [branch, bump, npmVersions, gitTags, currentVersion] = argv;

  if (!branch || !bump || !npmVersions || !gitTags || !isReleaseBranch(branch) || !isVersionBump(bump)) {
    throw new Error("Usage: version-helper <main|dev> <major|minor|patch|none> <npm-versions> <git-tags> [current-package-version]");
  }

  process.stdout.write(computeReleaseVersion({ branch, bump, npmVersions, gitTags, currentVersion }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2));
}
