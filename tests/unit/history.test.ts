import { describe, it, expect } from "vitest";
import { BuildHistory } from "../../src/history/buildHistory.js";
import type { BuildHistoryEntry } from "../../src/types.js";

function makeEntry(id: string): BuildHistoryEntry {
  return {
    id,
    timestamp: Date.now(),
    profile: "default",
    originalPath: `/tmp/${id}.apk`,
    renamedFilename: `${id}.apk`,
    metadata: {
      filePath: `/tmp/${id}.apk`,
      fileSize: 1024,
      appName: "app",
      packageName: "com.test",
      versionName: "1.0.0",
      versionCode: "1",
      buildType: "release",
      source: "filename-fallback",
    },
    results: [],
  };
}

describe("BuildHistory", () => {
  it("returns newest entries first", () => {
    const h = new BuildHistory(3);
    h.append(makeEntry("a"));
    h.append(makeEntry("b"));
    h.append(makeEntry("c"));
    expect(h.list().map((e) => e.id)).toEqual(["c", "b", "a"]);
  });

  it("caps at capacity (ring buffer)", () => {
    const h = new BuildHistory(2);
    h.append(makeEntry("a"));
    h.append(makeEntry("b"));
    h.append(makeEntry("c"));
    expect(h.size()).toBe(2);
    expect(h.list().map((e) => e.id)).toEqual(["c", "b"]);
  });

  it("respects custom limit on list()", () => {
    const h = new BuildHistory(10);
    for (const id of ["a", "b", "c", "d"]) h.append(makeEntry(id));
    expect(h.list(2)).toHaveLength(2);
  });
});
