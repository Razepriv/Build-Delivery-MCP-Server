import path from "node:path";
import type { BuildMetadata } from "../types.js";
import { applyTemplate } from "./template.js";
import { copyWithUnique } from "../utils/fs.js";

const DEFAULT_STAGING = process.env.STAGING_DIR ?? "./.staging";

export interface RenameResult {
  readonly stagedPath: string;
  readonly stagedFilename: string;
}

export async function renameToStaging(
  meta: BuildMetadata,
  pattern: string,
  stagingDir: string = DEFAULT_STAGING,
): Promise<RenameResult> {
  const ext = path.extname(meta.filePath);
  const filename = applyTemplate(pattern, meta, { extension: ext });
  const stagedPath = await copyWithUnique(meta.filePath, stagingDir, filename);
  return { stagedPath, stagedFilename: path.basename(stagedPath) };
}
