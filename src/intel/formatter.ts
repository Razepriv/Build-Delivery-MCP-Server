import type {
  Changelog,
  ChangelogCommit,
  CrashStats,
} from "../types.js";

const TYPE_ORDER = ["feat", "fix", "perf", "refactor", "docs", "chore", "test", "ci", "build", "other"] as const;

function typeHeading(type: string): string {
  switch (type) {
    case "feat":
      return "Features";
    case "fix":
      return "Fixes";
    case "perf":
      return "Performance";
    case "refactor":
      return "Refactors";
    case "docs":
      return "Docs";
    case "chore":
      return "Chores";
    case "test":
      return "Tests";
    case "ci":
      return "CI";
    case "build":
      return "Build";
    default:
      return "Other";
  }
}

function sortedTypes(groups: Readonly<Record<string, readonly ChangelogCommit[]>>): string[] {
  const keys = Object.keys(groups);
  return keys.sort((a, b) => {
    const ai = TYPE_ORDER.indexOf(a as (typeof TYPE_ORDER)[number]);
    const bi = TYPE_ORDER.indexOf(b as (typeof TYPE_ORDER)[number]);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });
}

function commitLine(commit: ChangelogCommit): string {
  const scope = commit.scope ? `(${commit.scope}) ` : "";
  const breaking = commit.breaking ? "⚠️ BREAKING — " : "";
  return `${breaking}${scope}${commit.subject}`;
}

/** Plain-text changelog (for Telegram/Slack/Discord/WhatsApp captions). */
export function formatChangelogText(changelog: Changelog): string {
  const lines: string[] = [];
  lines.push(`What's changed (${changelog.fromRef} → ${changelog.toRef}):`);
  for (const type of sortedTypes(changelog.groups)) {
    const commits = changelog.groups[type] ?? [];
    if (commits.length === 0) continue;
    lines.push(`• ${typeHeading(type)}:`);
    for (const c of commits.slice(0, 5)) {
      lines.push(`  – ${commitLine(c)}`);
    }
    if (commits.length > 5) {
      lines.push(`  – …and ${commits.length - 5} more`);
    }
  }
  return lines.join("\n");
}

/** HTML changelog block for Telegram + Email. */
export function formatChangelogHtml(changelog: Changelog): string {
  const escape = (s: string): string =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const sections: string[] = [];
  for (const type of sortedTypes(changelog.groups)) {
    const commits = changelog.groups[type] ?? [];
    if (commits.length === 0) continue;
    const items = commits
      .slice(0, 5)
      .map((c) => `<li>${escape(commitLine(c))}</li>`)
      .join("");
    const more =
      commits.length > 5
        ? `<li><em>…and ${commits.length - 5} more</em></li>`
        : "";
    sections.push(
      `<b>${escape(typeHeading(type))}</b><ul>${items}${more}</ul>`,
    );
  }
  if (sections.length === 0) return "";
  return `<b>What's changed</b> <i>(${escape(changelog.fromRef)} → ${escape(
    changelog.toRef,
  )})</i><br>${sections.join("")}`;
}

function formatPercentage(rate: number | undefined): string | null {
  if (rate === undefined) return null;
  return `${(rate * 100).toFixed(2)}%`;
}

/** Plain-text crash stats summary. */
export function formatCrashStatsText(stats: CrashStats): string {
  const lines: string[] = [`Stability of v${stats.versionName}:`];
  const rate = formatPercentage(stats.crashFreeRate);
  if (rate) lines.push(`  • Crash-free users: ${rate}`);
  if (stats.totalCrashes !== undefined) {
    lines.push(`  • Total crashes: ${stats.totalCrashes}`);
  }
  if (stats.affectedUsers !== undefined) {
    lines.push(`  • Affected users: ${stats.affectedUsers}`);
  }
  if (stats.topIssues && stats.topIssues.length > 0) {
    lines.push(`  • Top issue: ${stats.topIssues[0]!.title} (×${stats.topIssues[0]!.count})`);
  }
  return lines.join("\n");
}

/** HTML crash stats summary for Telegram + Email. */
export function formatCrashStatsHtml(stats: CrashStats): string {
  const escape = (s: string): string =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const facts: string[] = [];
  const rate = formatPercentage(stats.crashFreeRate);
  if (rate) facts.push(`<li>Crash-free users: <b>${rate}</b></li>`);
  if (stats.totalCrashes !== undefined) {
    facts.push(`<li>Total crashes: ${stats.totalCrashes}</li>`);
  }
  if (stats.affectedUsers !== undefined) {
    facts.push(`<li>Affected users: ${stats.affectedUsers}</li>`);
  }
  if (stats.topIssues && stats.topIssues.length > 0) {
    facts.push(
      `<li>Top issue: ${escape(stats.topIssues[0]!.title)} (×${stats.topIssues[0]!.count})</li>`,
    );
  }
  if (facts.length === 0) return "";
  return `<b>Stability of v${escape(stats.versionName)}</b><ul>${facts.join("")}</ul>`;
}

/** A short "view + install" link block for caption inclusion. */
export function formatInstallLinkText(installUrl: string): string {
  return `Install: ${installUrl}`;
}

export function formatInstallLinkHtml(installUrl: string): string {
  const safe = installUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return `<a href="${safe}">Tap to install</a>`;
}
