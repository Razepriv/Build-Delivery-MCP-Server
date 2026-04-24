import path from "node:path";
import type { BuildMetadata } from "../types.js";
import { parseApk } from "./apkParser.js";
import { parseAab } from "./aabParser.js";
import { filenameFallback } from "./filenameFallback.js";

export async function parseBuildFile(filePath: string): Promise<BuildMetadata> {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".apk":
      return parseApk(filePath);
    case ".aab":
      return parseAab(filePath);
    default:
      return filenameFallback(filePath);
  }
}
