import path from "node:path";
import fs from "fs-extra";
import type { InstallOutcome, McpServerEntry } from "../types.js";
import { backupIfExists } from "../backup.js";

interface JsonMcpFile {
  mcpServers?: Record<string, McpServerEntry>;
  [key: string]: unknown;
}

function entriesEqual(a: McpServerEntry, b: McpServerEntry): boolean {
  if (a.command !== b.command) return false;
  if (a.args.length !== b.args.length) return false;
  for (let i = 0; i < a.args.length; i += 1) {
    if (a.args[i] !== b.args[i]) return false;
  }
  const aEnv = a.env ?? {};
  const bEnv = b.env ?? {};
  const aKeys = Object.keys(aEnv).sort();
  const bKeys = Object.keys(bEnv).sort();
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i += 1) {
    if (aKeys[i] !== bKeys[i]) return false;
    const k = aKeys[i]!;
    if (aEnv[k] !== bEnv[k]) return false;
  }
  return true;
}

export interface JsonMcpWriteOptions {
  readonly agentId: import("../types.js").AgentId;
  readonly filePath: string;
  readonly entryName: string;
  readonly entry: McpServerEntry;
  readonly dryRun?: boolean;
}

/**
 * Idempotently merge an MCP entry into a Claude-Desktop-style JSON config
 * (`{ "mcpServers": { ... } }`). Preserves all unrelated keys. Always
 * writes a timestamped backup if the file already exists.
 */
export async function writeJsonMcp(
  options: JsonMcpWriteOptions,
): Promise<InstallOutcome> {
  const { filePath, entryName, entry, agentId, dryRun } = options;
  let parsed: JsonMcpFile = {};
  let exists = false;
  try {
    if (await fs.pathExists(filePath)) {
      exists = true;
      const raw = await fs.readFile(filePath, "utf8");
      if (raw.trim().length > 0) {
        parsed = JSON.parse(raw) as JsonMcpFile;
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

  const existing = parsed.mcpServers?.[entryName];
  const isUpdate = Boolean(existing);
  if (existing && entriesEqual(existing, entry)) {
    return { agentId, path: filePath, status: "unchanged" };
  }

  const next: JsonMcpFile = {
    ...parsed,
    mcpServers: {
      ...(parsed.mcpServers ?? {}),
      [entryName]: { ...entry },
    },
  };

  if (dryRun) {
    return {
      agentId,
      path: filePath,
      status: isUpdate ? "updated" : "added",
      message: "dry run — no file written",
    };
  }

  const backup = exists ? await backupIfExists(filePath) : null;
  await fs.ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(next, null, 2) + "\n", "utf8");

  return {
    agentId,
    path: filePath,
    status: isUpdate ? "updated" : "added",
    backupPath: backup ?? undefined,
  };
}
