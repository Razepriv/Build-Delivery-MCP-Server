import type { BuildMetadata, Changelog, CrashStats } from "../types.js";
import { bytesToMB } from "../utils/fs.js";
import {
  formatChangelogHtml,
  formatChangelogText,
  formatCrashStatsHtml,
  formatCrashStatsText,
  formatInstallLinkHtml,
  formatInstallLinkText,
} from "../intel/formatter.js";

/**
 * Optional intel sections to append after the standard caption body.
 * The pipeline assembles this once per build (changelog + crash stats)
 * plus once per recipient (install URL, when tracking is enabled).
 */
export interface IntelPayload {
  readonly changelog?: Changelog | null;
  readonly crashStats?: CrashStats | null;
  readonly installUrl?: string;
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function timestamp(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function intelTextSections(intel?: IntelPayload): string[] {
  const lines: string[] = [];
  if (intel?.installUrl) {
    lines.push("", formatInstallLinkText(intel.installUrl));
  }
  if (intel?.changelog) {
    lines.push("", formatChangelogText(intel.changelog));
  }
  if (intel?.crashStats) {
    lines.push("", formatCrashStatsText(intel.crashStats));
  }
  return lines;
}

export function telegramCaption(
  meta: BuildMetadata,
  customMessage?: string,
  intel?: IntelPayload,
): string {
  const lines = [
    `📦 <b>${escapeHtml(meta.appName)}</b>`,
    `<b>Version:</b> ${escapeHtml(meta.versionName)} (code ${escapeHtml(meta.versionCode)})`,
    `<b>Package:</b> <code>${escapeHtml(meta.packageName)}</code>`,
    `<b>Build:</b> ${meta.buildType}`,
    `<b>Size:</b> ${bytesToMB(meta.fileSize)} MB`,
    `<b>Time:</b> ${timestamp()} UTC`,
  ];
  if (meta.minSdkVersion) {
    lines.push(`<b>minSDK:</b> ${meta.minSdkVersion}${meta.targetSdkVersion ? ` · <b>targetSDK:</b> ${meta.targetSdkVersion}` : ""}`);
  }
  if (customMessage) {
    lines.push("", escapeHtml(customMessage));
  }
  // Telegram supports a small HTML subset; we use the HTML intel formatters
  // when available and fall back to text when they would be empty.
  if (intel?.installUrl) {
    lines.push("", formatInstallLinkHtml(intel.installUrl));
  }
  if (intel?.changelog) {
    const html = formatChangelogHtml(intel.changelog);
    if (html) lines.push("", html);
  }
  if (intel?.crashStats) {
    const html = formatCrashStatsHtml(intel.crashStats);
    if (html) lines.push("", html);
  }
  return lines.join("\n");
}

export function whatsappCaption(
  meta: BuildMetadata,
  customMessage?: string,
  intel?: IntelPayload,
): string {
  const lines = [
    `📦 *${meta.appName}*`,
    `*Version:* ${meta.versionName} (code ${meta.versionCode})`,
    `*Package:* ${meta.packageName}`,
    `*Build:* ${meta.buildType}`,
    `*Size:* ${bytesToMB(meta.fileSize)} MB`,
    `*Time:* ${timestamp()} UTC`,
  ];
  if (customMessage) {
    lines.push("", customMessage);
  }
  lines.push(...intelTextSections(intel));
  return lines.join("\n");
}

/** Slack uses *bold* and `inline code` markdown ("mrkdwn" mode). */
export function slackCaption(
  meta: BuildMetadata,
  customMessage?: string,
  intel?: IntelPayload,
): string {
  const lines = [
    `:package: *${meta.appName}*`,
    `*Version:* ${meta.versionName} (code ${meta.versionCode})`,
    `*Package:* \`${meta.packageName}\``,
    `*Build:* ${meta.buildType}`,
    `*Size:* ${bytesToMB(meta.fileSize)} MB`,
    `*Time:* ${timestamp()} UTC`,
  ];
  if (meta.minSdkVersion) {
    lines.push(
      `*minSDK:* ${meta.minSdkVersion}${meta.targetSdkVersion ? ` · *targetSDK:* ${meta.targetSdkVersion}` : ""}`,
    );
  }
  if (customMessage) {
    lines.push("", customMessage);
  }
  lines.push(...intelTextSections(intel));
  return lines.join("\n");
}

/** Discord supports the same markdown subset Slack uses, plus emoji shortcodes. */
export function discordCaption(
  meta: BuildMetadata,
  customMessage?: string,
  intel?: IntelPayload,
): string {
  const lines = [
    `📦 **${meta.appName}**`,
    `**Version:** ${meta.versionName} (code ${meta.versionCode})`,
    `**Package:** \`${meta.packageName}\``,
    `**Build:** ${meta.buildType}`,
    `**Size:** ${bytesToMB(meta.fileSize)} MB`,
    `**Time:** ${timestamp()} UTC`,
  ];
  if (customMessage) {
    lines.push("", customMessage);
  }
  lines.push(...intelTextSections(intel));
  return lines.join("\n");
}

/** Email subject line — short, scannable, identifies the build. */
export function emailSubject(meta: BuildMetadata): string {
  return `[Build] ${meta.appName} v${meta.versionName} (${meta.buildType})`;
}

/** Plain-text fallback body for email. */
export function emailTextBody(
  meta: BuildMetadata,
  customMessage?: string,
  intel?: IntelPayload,
): string {
  const lines = [
    `${meta.appName} — v${meta.versionName} (code ${meta.versionCode})`,
    "",
    `Package:  ${meta.packageName}`,
    `Build:    ${meta.buildType}`,
    `Size:     ${bytesToMB(meta.fileSize)} MB`,
    `Time:     ${timestamp()} UTC`,
  ];
  if (meta.minSdkVersion) {
    lines.push(
      `minSDK:   ${meta.minSdkVersion}${meta.targetSdkVersion ? ` (target ${meta.targetSdkVersion})` : ""}`,
    );
  }
  if (customMessage) {
    lines.push("", customMessage);
  }
  lines.push(...intelTextSections(intel));
  lines.push("", "— Build Delivery MCP");
  return lines.join("\n");
}

/** HTML email body — renders well on most clients without inline CSS. */
export function emailHtmlBody(
  meta: BuildMetadata,
  customMessage?: string,
  intel?: IntelPayload,
): string {
  const escape = escapeHtml;
  const customLine = customMessage
    ? `<p style="margin-top:16px;color:#333;">${escape(customMessage).replace(/\n/g, "<br>")}</p>`
    : "";
  const intelBlocks: string[] = [];
  if (intel?.installUrl) {
    intelBlocks.push(
      `<p style="margin-top:16px;font-weight:bold;">${formatInstallLinkHtml(intel.installUrl)}</p>`,
    );
  }
  if (intel?.changelog) {
    const html = formatChangelogHtml(intel.changelog);
    if (html) intelBlocks.push(`<div style="margin-top:16px;">${html}</div>`);
  }
  if (intel?.crashStats) {
    const html = formatCrashStatsHtml(intel.crashStats);
    if (html) intelBlocks.push(`<div style="margin-top:16px;">${html}</div>`);
  }

  return `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#111;">
  <h2 style="margin:0 0 12px 0;">📦 ${escape(meta.appName)}</h2>
  <table style="border-collapse:collapse;font-size:14px;">
    <tr><td style="padding:4px 12px 4px 0;color:#666;">Version</td><td>${escape(meta.versionName)} <span style="color:#888;">(code ${escape(meta.versionCode)})</span></td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#666;">Package</td><td><code>${escape(meta.packageName)}</code></td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#666;">Build</td><td>${escape(meta.buildType)}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#666;">Size</td><td>${bytesToMB(meta.fileSize)} MB</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#666;">Time</td><td>${timestamp()} UTC</td></tr>
    ${meta.minSdkVersion ? `<tr><td style="padding:4px 12px 4px 0;color:#666;">minSDK</td><td>${escape(meta.minSdkVersion)}${meta.targetSdkVersion ? ` (target ${escape(meta.targetSdkVersion)})` : ""}</td></tr>` : ""}
  </table>
  ${customLine}
  ${intelBlocks.join("\n")}
  <hr style="margin-top:24px;border:none;border-top:1px solid #eee;">
  <p style="color:#999;font-size:12px;">Sent by Build Delivery MCP</p>
</body></html>`;
}

/** Adaptive Card payload for Microsoft Teams incoming webhook. */
export function teamsCard(
  meta: BuildMetadata,
  customMessage?: string,
  intel?: IntelPayload,
): unknown {
  const facts = [
    { title: "Version", value: `${meta.versionName} (code ${meta.versionCode})` },
    { title: "Package", value: meta.packageName },
    { title: "Build", value: meta.buildType },
    { title: "Size", value: `${bytesToMB(meta.fileSize)} MB` },
    { title: "Time", value: `${timestamp()} UTC` },
  ];
  if (meta.minSdkVersion) {
    facts.push({
      title: "minSDK",
      value: meta.targetSdkVersion
        ? `${meta.minSdkVersion} (target ${meta.targetSdkVersion})`
        : meta.minSdkVersion,
    });
  }
  if (intel?.crashStats?.crashFreeRate !== undefined) {
    facts.push({
      title: "Crash-free",
      value: `${(intel.crashStats.crashFreeRate * 100).toFixed(2)}% (v${intel.crashStats.versionName})`,
    });
  }

  const body: unknown[] = [
    {
      type: "TextBlock",
      size: "Large",
      weight: "Bolder",
      text: `📦 ${meta.appName}`,
    },
    { type: "FactSet", facts },
  ];
  if (customMessage) {
    body.push({
      type: "TextBlock",
      wrap: true,
      text: customMessage,
      spacing: "Medium",
    });
  }
  if (intel?.changelog) {
    body.push({
      type: "TextBlock",
      wrap: true,
      text: formatChangelogText(intel.changelog),
      spacing: "Medium",
    });
  }

  const actions: unknown[] = [];
  if (intel?.installUrl) {
    actions.push({
      type: "Action.OpenUrl",
      title: "Install",
      url: intel.installUrl,
    });
  }

  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.5",
          body,
          actions: actions.length > 0 ? actions : undefined,
        },
      },
    ],
  };
}
