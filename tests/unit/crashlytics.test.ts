import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import { readCrashStats } from "../../src/intel/crashlytics.js";

describe("readCrashStats", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bdm-crash-"));
  });

  afterAll(async () => {
    await fs.remove(tmpDir);
  });

  it("returns null when disabled", async () => {
    const stats = await readCrashStats({ enabled: false });
    expect(stats).toBeNull();
  });

  it("returns null when source/path are missing", async () => {
    const stats = await readCrashStats({ enabled: true });
    expect(stats).toBeNull();
  });

  it("reads from a JSON file", async () => {
    const file = path.join(tmpDir, "stats.json");
    await fs.writeJson(file, {
      versionName: "2.4.0",
      crashFreeRate: 0.95,
      totalCrashes: 12,
      affectedUsers: 8,
      topIssues: [{ title: "Crash A", count: 5 }],
    });
    const stats = await readCrashStats({
      enabled: true,
      source: "file",
      path: file,
    });
    expect(stats).not.toBeNull();
    expect(stats!.versionName).toBe("2.4.0");
    expect(stats!.crashFreeRate).toBe(0.95);
    expect(stats!.topIssues).toHaveLength(1);
    expect(stats!.source).toBe("file");
  });

  it("returns null on a missing file", async () => {
    const stats = await readCrashStats({
      enabled: true,
      source: "file",
      path: path.join(tmpDir, "missing.json"),
    });
    expect(stats).toBeNull();
  });

  it("returns null when JSON is shaped wrong", async () => {
    const file = path.join(tmpDir, "bad.json");
    await fs.writeJson(file, { wrong: "shape" });
    const stats = await readCrashStats({
      enabled: true,
      source: "file",
      path: file,
    });
    expect(stats).toBeNull();
  });

  it("coerces string numbers", async () => {
    const file = path.join(tmpDir, "string-numbers.json");
    await fs.writeJson(file, {
      versionName: "1.2.3",
      crashFreeRate: "0.9",
      totalCrashes: "7",
    });
    const stats = await readCrashStats({
      enabled: true,
      source: "file",
      path: file,
    });
    expect(stats!.crashFreeRate).toBe(0.9);
    expect(stats!.totalCrashes).toBe(7);
  });
});
