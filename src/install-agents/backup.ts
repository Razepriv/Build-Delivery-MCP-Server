import fs from "fs-extra";

/**
 * Make a sibling backup of `filePath` if it exists. Returns the backup
 * path (or null if the source didn't exist). Backup naming includes a
 * timestamp so re-runs never clobber prior backups.
 */
export async function backupIfExists(filePath: string): Promise<string | null> {
  if (!(await fs.pathExists(filePath))) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = `${filePath}.bak.${stamp}`;
  await fs.copy(filePath, backup);
  return backup;
}
