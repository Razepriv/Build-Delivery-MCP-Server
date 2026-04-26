import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "fs-extra";
import type {
  Changelog,
  ChangelogCommit,
  ChangelogConfig,
} from "../types.js";
import { logger } from "../utils/logger.js";

const execFileAsync = promisify(execFile);

const SEMVER_TAG = /^v?\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/;
const CONVENTIONAL = /^([a-z]+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/i;

export interface ChangelogOptions {
  /** Override the previous tag (default: most recent semver tag before HEAD). */
  readonly fromRef?: string;
  /** End ref. Defaults to HEAD. */
  readonly toRef?: string;
  /** Override the configured includeTypes. */
  readonly includeTypes?: readonly string[];
  /** Cap on commits. */
  readonly maxCommits?: number;
}

async function git(repoPath: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args as string[], {
    cwd: repoPath,
    maxBuffer: 16 * 1024 * 1024,
    timeout: 15_000,
  });
  return stdout;
}

async function isGitRepo(repoPath: string): Promise<boolean> {
  try {
    await git(repoPath, ["rev-parse", "--is-inside-work-tree"]);
    return true;
  } catch {
    return false;
  }
}

async function findPreviousTag(repoPath: string, toRef: string): Promise<string | null> {
  // Sort tags by semver descending (`version:refname` understands v-prefix
  // and pre-release segments). Falls back to creatordate if that ever
  // fails on an ancient git.
  try {
    const out = await git(repoPath, [
      "for-each-ref",
      "--sort=-version:refname",
      "--format=%(refname:short)",
      "refs/tags",
    ]);
    const tags = out.split("\n").map((s) => s.trim()).filter(Boolean);
    const semverTags = tags.filter((t) => SEMVER_TAG.test(t));
    if (semverTags.length === 0) return null;

    // Skip any tag that points at toRef itself.
    let toSha: string;
    try {
      toSha = (await git(repoPath, ["rev-parse", toRef])).trim();
    } catch {
      toSha = toRef;
    }

    for (const tag of semverTags) {
      try {
        const tagSha = (await git(repoPath, ["rev-parse", `${tag}^{commit}`])).trim();
        if (tagSha !== toSha) return tag;
      } catch {
        // skip unresolvable tag
      }
    }
    return null;
  } catch (err) {
    logger.warn(`Could not enumerate git tags: ${(err as Error).message}`);
    return null;
  }
}

function parseCommitLine(line: string): ChangelogCommit | null {
  // Expected format: <sha>%x09<author>%x09<subject>
  const [sha, author, subject] = line.split("\t");
  if (!sha || !subject) return null;

  const match = subject.match(CONVENTIONAL);
  if (match) {
    const [, type, scope, bang, rest] = match;
    return {
      sha: sha.slice(0, 7),
      type: type!.toLowerCase(),
      scope: scope || undefined,
      subject: rest!.trim(),
      author: author || undefined,
      breaking: bang === "!",
    };
  }
  return {
    sha: sha.slice(0, 7),
    type: "other",
    subject: subject.trim(),
    author: author || undefined,
  };
}

function groupCommits(
  commits: readonly ChangelogCommit[],
  includeTypes: readonly string[],
): Record<string, ChangelogCommit[]> {
  const groups: Record<string, ChangelogCommit[]> = {};
  const allow = new Set(includeTypes.map((t) => t.toLowerCase()));
  for (const commit of commits) {
    if (!allow.has(commit.type) && commit.type !== "other") continue;
    if (!groups[commit.type]) groups[commit.type] = [];
    groups[commit.type]!.push(commit);
  }
  return groups;
}

/**
 * Generate a structured changelog between two refs in a git repo.
 *
 * Returns null when the repo path is missing, isn't a git repo, or no
 * commits are found — callers should treat null as "skip changelog
 * section in caption" rather than as an error.
 */
export async function generateChangelog(
  config: ChangelogConfig,
  options: ChangelogOptions = {},
): Promise<Changelog | null> {
  if (!config.enabled) return null;

  const repoPath = path.resolve(config.repoPath ?? process.cwd());
  if (!(await fs.pathExists(repoPath))) {
    logger.warn(`Changelog repoPath does not exist: ${repoPath}`);
    return null;
  }
  if (!(await isGitRepo(repoPath))) {
    logger.debug(`${repoPath} is not a git repo; skipping changelog.`);
    return null;
  }

  const toRef = options.toRef ?? "HEAD";
  const fromRef =
    options.fromRef ?? (await findPreviousTag(repoPath, toRef)) ?? "";
  const range = fromRef ? `${fromRef}..${toRef}` : toRef;

  const max = options.maxCommits ?? config.maxCommits ?? 50;
  const includeTypes = options.includeTypes ?? config.includeTypes ?? [
    "feat",
    "fix",
    "perf",
    "refactor",
  ];

  let raw = "";
  try {
    raw = await git(repoPath, [
      "log",
      `-n${max}`,
      "--no-merges",
      "--pretty=format:%h%x09%an%x09%s",
      range,
    ]);
  } catch (err) {
    logger.warn(`git log failed for ${range}: ${(err as Error).message}`);
    return null;
  }

  const commits = raw
    .split("\n")
    .map((line) => parseCommitLine(line))
    .filter((c): c is ChangelogCommit => c !== null);

  if (commits.length === 0) return null;

  return {
    fromRef: fromRef || "(initial)",
    toRef,
    groups: groupCommits(commits, includeTypes),
    totalCommits: commits.length,
  };
}
