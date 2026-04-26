import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { generateChangelog } from "../../src/intel/changelog.js";

const HAS_GIT = (() => {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

function gitInit(repo: string): void {
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "test@test.local"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: repo });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: repo });
}

function gitCommit(repo: string, message: string): void {
  execFileSync("git", ["commit", "--allow-empty", "-q", "-m", message], { cwd: repo });
}

function gitTag(repo: string, tag: string): void {
  execFileSync("git", ["tag", tag], { cwd: repo });
}

describe.skipIf(!HAS_GIT)("generateChangelog", () => {
  let repo: string;

  beforeAll(async () => {
    repo = await fs.mkdtemp(path.join(os.tmpdir(), "bdm-changelog-"));
    gitInit(repo);
    gitCommit(repo, "feat: initial release");
    gitTag(repo, "v1.0.0");
    gitCommit(repo, "feat(auth): biometric login");
    gitCommit(repo, "fix: crash on cold start");
    gitCommit(repo, "refactor: split renamer module");
    gitCommit(repo, "chore: bump deps");
    gitTag(repo, "v1.1.0");
    gitCommit(repo, "feat: search bar"); // post-tag commit
  });

  afterAll(async () => {
    await fs.remove(repo);
  });

  it("returns null when disabled", async () => {
    const result = await generateChangelog({
      enabled: false,
    });
    expect(result).toBeNull();
  });

  it("groups commits between v1.0.0 and v1.1.0 by conventional-commit type", async () => {
    const result = await generateChangelog({
      enabled: true,
      repoPath: repo,
      maxCommits: 50,
      includeTypes: ["feat", "fix", "perf", "refactor"],
    }, { fromRef: "v1.0.0", toRef: "v1.1.0" });

    expect(result).not.toBeNull();
    expect(result!.fromRef).toBe("v1.0.0");
    expect(result!.toRef).toBe("v1.1.0");
    expect(result!.groups.feat?.length).toBe(1);
    expect(result!.groups.fix?.length).toBe(1);
    expect(result!.groups.refactor?.length).toBe(1);
    // chore is excluded by includeTypes
    expect(result!.groups.chore).toBeUndefined();
  });

  it("auto-discovers the previous semver tag", async () => {
    const result = await generateChangelog({
      enabled: true,
      repoPath: repo,
    });
    expect(result).not.toBeNull();
    // Most recent tag before HEAD is v1.1.0; HEAD has the post-tag feat commit.
    expect(result!.fromRef).toBe("v1.1.0");
    expect(result!.totalCommits).toBeGreaterThanOrEqual(1);
  });

  it("returns null for a non-git directory", async () => {
    const notRepo = await fs.mkdtemp(path.join(os.tmpdir(), "bdm-norepo-"));
    try {
      const result = await generateChangelog({
        enabled: true,
        repoPath: notRepo,
      });
      expect(result).toBeNull();
    } finally {
      await fs.remove(notRepo);
    }
  });
});
