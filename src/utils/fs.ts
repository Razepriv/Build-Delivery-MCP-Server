import fs from "fs-extra";
import path from "node:path";

export async function fileSizeBytes(filePath: string): Promise<number> {
  const stat = await fs.stat(filePath);
  return stat.size;
}

export function bytesToMB(bytes: number): number {
  return Math.round((bytes / (1024 * 1024)) * 100) / 100;
}

/**
 * Copy to staging, resolving name collisions with _1, _2, ... suffixes.
 * Returns the absolute path of the staged file.
 */
export async function copyWithUnique(
  source: string,
  destinationDir: string,
  preferredName: string,
): Promise<string> {
  await fs.ensureDir(destinationDir);
  const ext = path.extname(preferredName);
  const base = preferredName.slice(0, preferredName.length - ext.length);

  let candidate = path.join(destinationDir, preferredName);
  let counter = 1;
  while (await fs.pathExists(candidate)) {
    candidate = path.join(destinationDir, `${base}_${counter}${ext}`);
    counter += 1;
  }

  await fs.copy(source, candidate, { overwrite: false, errorOnExist: true });
  return candidate;
}

export async function safeRemove(filePath: string): Promise<void> {
  try {
    await fs.remove(filePath);
  } catch {
    // best-effort staging cleanup
  }
}

export async function waitForStableSize(
  filePath: string,
  thresholdMs: number,
  timeoutMs = 60_000,
): Promise<void> {
  const start = Date.now();
  let lastSize = -1;
  let stableSince = 0;

  while (Date.now() - start < timeoutMs) {
    try {
      const size = (await fs.stat(filePath)).size;
      if (size === lastSize) {
        if (stableSince === 0) stableSince = Date.now();
        if (Date.now() - stableSince >= thresholdMs) return;
      } else {
        lastSize = size;
        stableSince = 0;
      }
    } catch {
      // File may not yet exist; retry
    }
    await new Promise((r) => setTimeout(r, Math.min(500, thresholdMs / 4)));
  }
}
