import type { BuildMetadata } from "../types.js";
import { bytesToMB } from "../utils/fs.js";

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function telegramCaption(meta: BuildMetadata, customMessage?: string): string {
  const lines = [
    `📦 <b>${escapeHtml(meta.appName)}</b>`,
    `<b>Version:</b> ${escapeHtml(meta.versionName)} (code ${escapeHtml(meta.versionCode)})`,
    `<b>Package:</b> <code>${escapeHtml(meta.packageName)}</code>`,
    `<b>Build:</b> ${meta.buildType}`,
    `<b>Size:</b> ${bytesToMB(meta.fileSize)} MB`,
    `<b>Time:</b> ${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC`,
  ];
  if (meta.minSdkVersion) {
    lines.push(`<b>minSDK:</b> ${meta.minSdkVersion}${meta.targetSdkVersion ? ` · <b>targetSDK:</b> ${meta.targetSdkVersion}` : ""}`);
  }
  if (customMessage) {
    lines.push("", escapeHtml(customMessage));
  }
  return lines.join("\n");
}

export function whatsappCaption(meta: BuildMetadata, customMessage?: string): string {
  const lines = [
    `📦 *${meta.appName}*`,
    `*Version:* ${meta.versionName} (code ${meta.versionCode})`,
    `*Package:* ${meta.packageName}`,
    `*Build:* ${meta.buildType}`,
    `*Size:* ${bytesToMB(meta.fileSize)} MB`,
    `*Time:* ${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC`,
  ];
  if (customMessage) {
    lines.push("", customMessage);
  }
  return lines.join("\n");
}
