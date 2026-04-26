import path from "node:path";
import fs from "fs-extra";
import type { AgentId, InstallOutcome, McpServerEntry } from "../types.js";
import { backupIfExists } from "../backup.js";

/**
 * Trivially serialize an MCP entry as Codex's [mcp_servers.<name>] TOML
 * table. Only command, args, env are produced — the rest of the file is
 * preserved verbatim (we splice in/replace just the relevant table).
 */
function serializeTomlTable(name: string, entry: McpServerEntry): string {
  const lines: string[] = [];
  lines.push(`[mcp_servers.${tomlKey(name)}]`);
  lines.push(`command = ${tomlString(entry.command)}`);
  lines.push(`args = [${entry.args.map((a) => tomlString(a)).join(", ")}]`);
  if (entry.env && Object.keys(entry.env).length > 0) {
    const envLines = Object.entries(entry.env)
      .map(([k, v]) => `  ${tomlKey(k)} = ${tomlString(v)}`)
      .join(",\n");
    lines.push("env = {");
    lines.push(envLines);
    lines.push("}");
  }
  return lines.join("\n");
}

function tomlKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : tomlString(key);
}

function tomlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

const TABLE_HEADER = (name: string): RegExp =>
  new RegExp(`^\\[mcp_servers\\.${escapeRegExp(name)}\\]\\s*$`, "m");

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface ReplaceTableResult {
  readonly source: string;
  readonly changed: boolean;
}

function upsertTomlTable(
  source: string,
  entryName: string,
  block: string,
): ReplaceTableResult {
  const header = TABLE_HEADER(entryName);
  const headerMatch = header.exec(source);
  if (!headerMatch) {
    const trimmed = source.replace(/\s+$/, "");
    const next = trimmed.length > 0 ? `${trimmed}\n\n${block}\n` : `${block}\n`;
    return { source: next, changed: true };
  }
  // Replace from the matched header up to the next [section] or EOF.
  const start = headerMatch.index;
  const after = source.slice(start + headerMatch[0].length);
  const nextSection = /^\[/m.exec(after);
  const tableEnd = nextSection ? start + headerMatch[0].length + nextSection.index : source.length;
  const before = source.slice(0, start);
  const tail = source.slice(tableEnd);
  const next = `${before}${block}${tail.startsWith("\n") ? "" : "\n"}${tail}`;
  return { source: next, changed: next !== source };
}

export interface CodexWriteOptions {
  readonly agentId: AgentId;
  readonly filePath: string;
  readonly entryName: string;
  readonly entry: McpServerEntry;
  readonly dryRun?: boolean;
}

export async function writeCodexToml(options: CodexWriteOptions): Promise<InstallOutcome> {
  const { filePath, entryName, entry, agentId, dryRun } = options;
  let existing = "";
  let exists = false;
  if (await fs.pathExists(filePath)) {
    exists = true;
    existing = await fs.readFile(filePath, "utf8");
  }

  const block = serializeTomlTable(entryName, entry);
  const { source: next, changed } = upsertTomlTable(existing, entryName, block);

  if (!changed) {
    return { agentId, path: filePath, status: "unchanged" };
  }

  if (dryRun) {
    return {
      agentId,
      path: filePath,
      status: existing.length > 0 ? "updated" : "added",
      message: "dry run — no file written",
    };
  }

  const backup = exists ? await backupIfExists(filePath) : null;
  await fs.ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, next, "utf8");
  return {
    agentId,
    path: filePath,
    status: existing.length > 0 ? "updated" : "added",
    backupPath: backup ?? undefined,
  };
}
