import path from "node:path";
import type { BuildMetadata, BuildType } from "../types.js";
import { fileSizeBytes } from "../utils/fs.js";

const VERSION_PATTERN = /v?(\d+\.\d+(?:\.\d+)?(?:[-_.][\w-]+)?)/i;
const BUILD_TYPE_HINTS: Record<string, BuildType> = {
  release: "release",
  debug: "debug",
  prod: "release",
  dev: "debug",
  staging: "release",
};

function detectBuildType(name: string): BuildType {
  const lower = name.toLowerCase();
  for (const [hint, type] of Object.entries(BUILD_TYPE_HINTS)) {
    if (lower.includes(hint)) return type;
  }
  return "unknown";
}

function guessAppName(filename: string): string {
  const base = path.basename(filename, path.extname(filename));
  const cleaned = base
    .replace(VERSION_PATTERN, "")
    .replace(/[-_.](release|debug|prod|dev|staging)$/i, "")
    .replace(/[-_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || "app";
}

export async function filenameFallback(filePath: string): Promise<BuildMetadata> {
  const filename = path.basename(filePath);
  const versionMatch = filename.match(VERSION_PATTERN);

  return {
    filePath,
    fileSize: await fileSizeBytes(filePath),
    appName: guessAppName(filename),
    packageName: "unknown",
    versionName: versionMatch?.[1] ?? "0.0.0",
    versionCode: "0",
    buildType: detectBuildType(filename),
    source: "filename-fallback",
  };
}
