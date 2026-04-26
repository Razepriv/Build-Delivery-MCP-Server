import AdmZip from "adm-zip";
import bplist from "bplist-parser";
import type { BuildMetadata } from "../types.js";
import { fileSizeBytes } from "../utils/fs.js";
import { filenameFallback } from "./filenameFallback.js";
import { logger } from "../utils/logger.js";

interface InfoPlist {
  CFBundleName?: string;
  CFBundleDisplayName?: string;
  CFBundleExecutable?: string;
  CFBundleIdentifier?: string;
  CFBundleVersion?: string;
  CFBundleShortVersionString?: string;
  MinimumOSVersion?: string;
  DTPlatformVersion?: string;
  ["get-task-allow"]?: boolean;
  [key: string]: unknown;
}

const PLIST_INSIDE_IPA = /^Payload\/[^/]+\.app\/Info\.plist$/i;

function parsePlistBuffer(buffer: Buffer): InfoPlist | null {
  // Binary plists begin with "bplist00".
  if (buffer.slice(0, 6).toString("ascii") === "bplist") {
    try {
      const parsed = bplist.parseBuffer(buffer);
      const root = Array.isArray(parsed) ? parsed[0] : parsed;
      return root as InfoPlist;
    } catch (err) {
      logger.warn(`bplist parse failed: ${(err as Error).message}`);
      return null;
    }
  }

  // XML plist: simple regex extraction is enough for our needs (we only need
  // a handful of string keys; we never round-trip the file).
  try {
    return parseXmlPlist(buffer.toString("utf8"));
  } catch (err) {
    logger.warn(`xml plist parse failed: ${(err as Error).message}`);
    return null;
  }
}

function parseXmlPlist(xml: string): InfoPlist {
  const result: InfoPlist = {};
  const re = /<key>([^<]+)<\/key>\s*<(string|integer|true|false|real)(?:\/>|>([^<]*)<\/\2>)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    const [, key, kind, raw] = match;
    if (!key) continue;
    if (kind === "true") {
      result[key] = true;
    } else if (kind === "false") {
      result[key] = false;
    } else if (kind === "integer" || kind === "real") {
      result[key] = Number(raw);
    } else {
      result[key] = raw ?? "";
    }
  }
  return result;
}

function buildTypeFromPlist(plist: InfoPlist): BuildMetadata["buildType"] {
  // `get-task-allow` true → debug build (allows debugger attach). Release
  // builds typically strip or set this to false.
  if (plist["get-task-allow"] === true) return "debug";
  if (plist["get-task-allow"] === false) return "release";
  return "release";
}

export async function parseIpa(filePath: string): Promise<BuildMetadata> {
  try {
    const zip = new AdmZip(filePath);
    const entry = zip.getEntries().find((e) => PLIST_INSIDE_IPA.test(e.entryName));
    if (!entry) {
      logger.warn("IPA: Info.plist not found inside Payload/*.app — using filename fallback.");
      return filenameFallback(filePath);
    }

    const plist = parsePlistBuffer(entry.getData());
    if (!plist) {
      return filenameFallback(filePath);
    }

    return {
      filePath,
      fileSize: await fileSizeBytes(filePath),
      appName:
        plist.CFBundleDisplayName ??
        plist.CFBundleName ??
        plist.CFBundleExecutable ??
        plist.CFBundleIdentifier ??
        "app",
      packageName: plist.CFBundleIdentifier ?? "unknown",
      versionName: plist.CFBundleShortVersionString ?? plist.CFBundleVersion ?? "0.0.0",
      versionCode: plist.CFBundleVersion ?? "0",
      buildType: buildTypeFromPlist(plist),
      minSdkVersion: plist.MinimumOSVersion,
      targetSdkVersion: plist.DTPlatformVersion,
      source: "ipa-plist",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`IPA parse failed (${message}); falling back to filename.`);
    return filenameFallback(filePath);
  }
}
