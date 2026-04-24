import type { BuildMetadata, BuildType } from "../types.js";
import { resolveAapt, resolveAapt2, runTool } from "../utils/androidSdk.js";
import { fileSizeBytes } from "../utils/fs.js";
import { filenameFallback } from "./filenameFallback.js";
import { logger } from "../utils/logger.js";

interface AaptBadging {
  package?: string;
  versionCode?: string;
  versionName?: string;
  applicationLabel?: string;
  minSdkVersion?: string;
  targetSdkVersion?: string;
  debuggable: boolean;
}

function parseAaptBadging(stdout: string): AaptBadging {
  const result: AaptBadging = { debuggable: false };

  const pkgMatch = stdout.match(/package:\s+name='([^']+)'\s+versionCode='([^']+)'\s+versionName='([^']+)'/);
  if (pkgMatch) {
    result.package = pkgMatch[1];
    result.versionCode = pkgMatch[2];
    result.versionName = pkgMatch[3];
  }

  const labelMatch = stdout.match(/application-label(?:-[\w-]+)?:'([^']+)'/);
  if (labelMatch) result.applicationLabel = labelMatch[1];

  const appLineMatch = stdout.match(/application:\s+label='([^']+)'/);
  if (!result.applicationLabel && appLineMatch) {
    result.applicationLabel = appLineMatch[1];
  }

  const minSdkMatch = stdout.match(/sdkVersion:'(\d+)'/);
  if (minSdkMatch) result.minSdkVersion = minSdkMatch[1];

  const targetSdkMatch = stdout.match(/targetSdkVersion:'(\d+)'/);
  if (targetSdkMatch) result.targetSdkVersion = targetSdkMatch[1];

  result.debuggable =
    /application-debuggable/i.test(stdout) ||
    /debuggable='?true'?/i.test(stdout);

  return result;
}

function buildTypeFromDebuggable(debuggable: boolean): BuildType {
  return debuggable ? "debug" : "release";
}

export async function parseApk(filePath: string): Promise<BuildMetadata> {
  const aapt2Path = await resolveAapt2();
  const aaptPath = aapt2Path ? null : await resolveAapt();
  const binary = aapt2Path ?? aaptPath;

  if (!binary) {
    logger.debug("No aapt/aapt2 available; using filename fallback.");
    return filenameFallback(filePath);
  }

  try {
    const args = aapt2Path
      ? ["dump", "badging", filePath]
      : ["dump", "badging", filePath];
    const stdout = await runTool(binary, args);
    const parsed = parseAaptBadging(stdout);

    return {
      filePath,
      fileSize: await fileSizeBytes(filePath),
      appName: parsed.applicationLabel ?? parsed.package ?? "app",
      packageName: parsed.package ?? "unknown",
      versionName: parsed.versionName ?? "0.0.0",
      versionCode: parsed.versionCode ?? "0",
      buildType: buildTypeFromDebuggable(parsed.debuggable),
      minSdkVersion: parsed.minSdkVersion,
      targetSdkVersion: parsed.targetSdkVersion,
      source: aapt2Path ? "aapt2" : "aapt",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`APK parse via aapt failed (${message}); falling back to filename.`);
    return filenameFallback(filePath);
  }
}
