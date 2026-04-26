import path from "node:path";
import fs from "fs-extra";
import type { AgentId, InstallOutcome, McpServerEntry } from "../types.js";
import { backupIfExists } from "../backup.js";

/**
 * Continue.dev evolved its MCP shape across releases. Newer versions
 * accept the same `mcpServers` map as Claude Desktop; older releases
 * used `experimental.modelContextProtocolServers` (an array). We
 * write the modern shape and ALSO append the legacy entry, so a user
 * upgrading either direction keeps working.
 */
interface ContinueConfig {
  mcpServers?: Record<string, McpServerEntry>;
  experimental?: {
    modelContextProtocolServers?: Array<{
      name: string;
      transport: { type: "stdio"; command: string; args?: string[]; env?: Record<string, string> };
    }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface ContinueWriteOptions {
  readonly agentId: AgentId;
  readonly filePath: string;
  readonly entryName: string;
  readonly entry: McpServerEntry;
  readonly dryRun?: boolean;
}

export async function writeContinue(
  options: ContinueWriteOptions,
): Promise<InstallOutcome> {
  const { filePath, entryName, entry, agentId, dryRun } = options;

  // Continue ships YAML configs in newer versions. We don't auto-edit YAML;
  // direct the user to the path with a note.
  if (filePath.endsWith(".yaml") || filePath.endsWith(".yml")) {
    return {
      agentId,
      path: filePath,
      status: "skipped",
      message:
        "Continue.dev YAML configs are not auto-edited. Add the build-delivery MCP server entry by hand.",
    };
  }

  let parsed: ContinueConfig = {};
  let exists = false;
  try {
    if (await fs.pathExists(filePath)) {
      exists = true;
      const raw = await fs.readFile(filePath, "utf8");
      if (raw.trim().length > 0) {
        parsed = JSON.parse(raw) as ContinueConfig;
      }
    }
  } catch (err) {
    return {
      agentId,
      path: filePath,
      status: "error",
      message: `Could not parse existing config: ${(err as Error).message}`,
    };
  }

  const next: ContinueConfig = {
    ...parsed,
    mcpServers: {
      ...(parsed.mcpServers ?? {}),
      [entryName]: { ...entry },
    },
    experimental: {
      ...(parsed.experimental ?? {}),
      modelContextProtocolServers: upsertLegacyArray(
        parsed.experimental?.modelContextProtocolServers ?? [],
        entryName,
        entry,
      ),
    },
  };

  if (dryRun) {
    return {
      agentId,
      path: filePath,
      status: parsed.mcpServers?.[entryName] ? "updated" : "added",
      message: "dry run — no file written",
    };
  }

  const backup = exists ? await backupIfExists(filePath) : null;
  await fs.ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(next, null, 2) + "\n", "utf8");
  return {
    agentId,
    path: filePath,
    status: parsed.mcpServers?.[entryName] ? "updated" : "added",
    backupPath: backup ?? undefined,
  };
}

function upsertLegacyArray(
  current: NonNullable<NonNullable<ContinueConfig["experimental"]>["modelContextProtocolServers"]>,
  name: string,
  entry: McpServerEntry,
): NonNullable<NonNullable<ContinueConfig["experimental"]>["modelContextProtocolServers"]> {
  const filtered = current.filter((s) => s.name !== name);
  filtered.push({
    name,
    transport: {
      type: "stdio",
      command: entry.command,
      args: [...entry.args],
      env: entry.env ? { ...entry.env } : undefined,
    },
  });
  return filtered;
}
