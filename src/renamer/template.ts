import path from "node:path";
import type { BuildMetadata } from "../types.js";
import { sanitizeAppName, sanitizeGeneric, sanitizeVersion } from "./sanitize.js";

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

function buildPlaceholders(meta: BuildMetadata, now: Date): Record<string, string> {
  const year = now.getFullYear();
  const month = pad(now.getMonth() + 1);
  const day = pad(now.getDate());
  const hour = pad(now.getHours());
  const minute = pad(now.getMinutes());
  const second = pad(now.getSeconds());

  return {
    appName: sanitizeAppName(meta.appName),
    version: sanitizeVersion(meta.versionName),
    versionCode: sanitizeGeneric(meta.versionCode),
    buildType: meta.buildType,
    package: sanitizeGeneric(meta.packageName),
    date: `${year}-${month}-${day}`,
    time: `${hour}-${minute}-${second}`,
    timestamp: String(now.getTime()),
    year: String(year),
    month,
    day,
    hour,
    minute,
    second,
  };
}

export function applyTemplate(
  pattern: string,
  meta: BuildMetadata,
  options: { extension?: string; now?: Date } = {},
): string {
  const now = options.now ?? new Date();
  const placeholders = buildPlaceholders(meta, now);

  const rendered = pattern.replace(/\{([a-zA-Z]+)\}/g, (full, key) => {
    const value = placeholders[key as keyof typeof placeholders];
    return value ?? full;
  });

  const ext = options.extension ?? path.extname(meta.filePath);
  if (rendered.toLowerCase().endsWith(ext.toLowerCase())) return rendered;
  return `${rendered}${ext}`;
}
