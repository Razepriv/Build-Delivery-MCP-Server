import { describe, it, expect } from "vitest";
import { applyTemplate } from "../../src/renamer/template.js";
import type { BuildMetadata } from "../../src/types.js";

const meta: BuildMetadata = {
  filePath: "/tmp/app-release.apk",
  fileSize: 10_000_000,
  appName: "Webverse Arena",
  packageName: "com.webverse.arena",
  versionName: "2.4.1",
  versionCode: "241",
  buildType: "release",
  source: "aapt2",
};

const fixedDate = new Date("2026-04-25T14:30:25.000Z");

describe("applyTemplate", () => {
  it("sanitizes app name and fills standard placeholders", () => {
    const out = applyTemplate(
      "{appName}_v{version}_{buildType}_{date}_{time}",
      meta,
      { now: fixedDate },
    );
    expect(out).toMatch(/^webverse_arena_v2\.4\.1_release_2026-04-25_\d{2}-\d{2}-\d{2}\.apk$/);
  });

  it("appends .apk extension when missing", () => {
    const out = applyTemplate("{appName}", meta, { now: fixedDate });
    expect(out.endsWith(".apk")).toBe(true);
  });

  it("preserves extension if already present", () => {
    const out = applyTemplate("{appName}.apk", meta, { now: fixedDate });
    expect(out).toBe("webverse_arena.apk");
  });

  it("leaves unknown placeholders untouched", () => {
    const out = applyTemplate("{appName}_{unknown}", meta, { now: fixedDate });
    expect(out).toContain("{unknown}");
  });

  it("fills package placeholder", () => {
    const out = applyTemplate("{package}_v{version}", meta, { now: fixedDate });
    expect(out.startsWith("com.webverse.arena")).toBe(true);
  });
});
