import type { BuildMetadata, BuildType } from "../types.js";
import { resolveBundletool, runTool } from "../utils/androidSdk.js";
import { fileSizeBytes } from "../utils/fs.js";
import { filenameFallback } from "./filenameFallback.js";
import { logger } from "../utils/logger.js";

function pick(tag: string, xml: string): string | undefined {
  const pattern = new RegExp(`${tag}="([^"]+)"`);
  const match = xml.match(pattern);
  return match?.[1];
}

function buildTypeFromAab(xml: string): BuildType {
  return /android:debuggable="true"/i.test(xml) ? "debug" : "release";
}

export async function parseAab(filePath: string): Promise<BuildMetadata> {
  const bundletool = await resolveBundletool();
  if (!bundletool) {
    logger.debug("bundletool not available; using filename fallback for AAB.");
    return filenameFallback(filePath);
  }

  try {
    const xml = await runTool("java", [
      "-jar",
      bundletool,
      "dump",
      "manifest",
      `--bundle=${filePath}`,
    ]);

    return {
      filePath,
      fileSize: await fileSizeBytes(filePath),
      appName: pick("android:label", xml) ?? pick("package", xml) ?? "app",
      packageName: pick("package", xml) ?? "unknown",
      versionName: pick("android:versionName", xml) ?? "0.0.0",
      versionCode: pick("android:versionCode", xml) ?? "0",
      buildType: buildTypeFromAab(xml),
      minSdkVersion: pick("android:minSdkVersion", xml),
      targetSdkVersion: pick("android:targetSdkVersion", xml),
      source: "bundletool",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`AAB parse via bundletool failed (${message}); falling back to filename.`);
    return filenameFallback(filePath);
  }
}
