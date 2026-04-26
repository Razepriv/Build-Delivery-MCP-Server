import { describe, it, expect } from "vitest";
import {
  formatChangelogText,
  formatChangelogHtml,
  formatCrashStatsText,
  formatCrashStatsHtml,
  formatInstallLinkHtml,
  formatInstallLinkText,
} from "../../src/intel/formatter.js";
import type { Changelog, CrashStats } from "../../src/types.js";

const changelog: Changelog = {
  fromRef: "v2.4.0",
  toRef: "v2.4.1",
  totalCommits: 4,
  groups: {
    feat: [
      { sha: "abc1234", type: "feat", subject: "search bar on home" },
      { sha: "def5678", type: "feat", scope: "auth", subject: "biometric login", breaking: true },
    ],
    fix: [{ sha: "111aaaa", type: "fix", subject: "crash on cold start" }],
    other: [{ sha: "222bbbb", type: "other", subject: "Initial commit" }],
  },
};

describe("formatChangelogText", () => {
  it("orders sections feat → fix → … → other", () => {
    const text = formatChangelogText(changelog);
    const featIdx = text.indexOf("Features");
    const fixIdx = text.indexOf("Fixes");
    const otherIdx = text.indexOf("Other");
    expect(featIdx).toBeGreaterThan(-1);
    expect(featIdx).toBeLessThan(fixIdx);
    expect(fixIdx).toBeLessThan(otherIdx);
  });

  it("marks BREAKING commits", () => {
    const text = formatChangelogText(changelog);
    expect(text).toContain("BREAKING");
    expect(text).toContain("biometric login");
  });

  it("includes the from→to reference range", () => {
    const text = formatChangelogText(changelog);
    expect(text).toContain("v2.4.0 → v2.4.1");
  });
});

describe("formatChangelogHtml", () => {
  it("emits <ul><li> blocks per group", () => {
    const html = formatChangelogHtml(changelog);
    expect(html).toContain("<b>Features</b>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>");
    expect(html).toContain("biometric login");
  });

  it("escapes html in commit subjects", () => {
    const cl: Changelog = {
      fromRef: "v0.0.1",
      toRef: "v0.0.2",
      totalCommits: 1,
      groups: {
        feat: [{ sha: "abc1234", type: "feat", subject: "<script>oops</script>" }],
      },
    };
    const html = formatChangelogHtml(cl);
    expect(html).not.toContain("<script>oops</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("formatCrashStats*", () => {
  const stats: CrashStats = {
    versionName: "2.4.0",
    crashFreeRate: 0.987,
    totalCrashes: 14,
    affectedUsers: 9,
    topIssues: [{ title: "NPE in checkout", count: 6 }],
    source: "file",
    fetchedAt: 0,
  };

  it("formats text with percentage", () => {
    const text = formatCrashStatsText(stats);
    expect(text).toContain("Stability of v2.4.0");
    expect(text).toContain("98.70%");
    expect(text).toContain("Total crashes: 14");
    expect(text).toContain("Top issue: NPE in checkout");
  });

  it("formats html with bold percentage", () => {
    const html = formatCrashStatsHtml(stats);
    expect(html).toContain("<b>Stability of v2.4.0</b>");
    expect(html).toContain("<b>98.70%</b>");
  });

  it("omits missing metrics gracefully", () => {
    const sparse: CrashStats = {
      versionName: "1.0.0",
      source: "manual",
      fetchedAt: 0,
    };
    const text = formatCrashStatsText(sparse);
    expect(text).toContain("Stability of v1.0.0");
    expect(text).not.toContain("Crash-free");
  });
});

describe("formatInstallLink*", () => {
  it("wraps URL in plain text", () => {
    expect(formatInstallLinkText("https://x.test/install/abc")).toBe(
      "Install: https://x.test/install/abc",
    );
  });

  it("escapes ampersands and quotes in HTML href", () => {
    const html = formatInstallLinkHtml('https://x.test/?a=1&b="2"');
    expect(html).toContain("&amp;");
    expect(html).toContain("&quot;");
    expect(html).toContain("Tap to install");
  });
});
