import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import type { AgentDescriptor, DetectedAgent } from "./types.js";

const HOME = os.homedir();
const APPDATA = process.env.APPDATA ?? path.join(HOME, "AppData", "Roaming");
const XDG_CONFIG = process.env.XDG_CONFIG_HOME ?? path.join(HOME, ".config");

function platformPaths(macPath: string, winRelative: string, linuxRelative: string): string[] {
  if (process.platform === "darwin") {
    return [path.join(HOME, "Library", "Application Support", macPath)];
  }
  if (process.platform === "win32") {
    return [path.join(APPDATA, winRelative)];
  }
  return [path.join(XDG_CONFIG, linuxRelative)];
}

export const AGENTS: readonly AgentDescriptor[] = [
  {
    id: "claude-desktop",
    displayName: "Claude Desktop",
    configPaths: platformPaths(
      "Claude/claude_desktop_config.json",
      "Claude/claude_desktop_config.json",
      "Claude/claude_desktop_config.json",
    ),
    instructionPaths: [
      path.join(HOME, ".claude", "CLAUDE.md"),
    ],
    format: "json-mcp",
  },
  {
    id: "claude-code",
    displayName: "Claude Code (CLI)",
    // Claude Code reads MCP servers from a top-level mcpServers object in
    // ~/.claude.json (per-user) and from project-level .mcp.json files.
    configPaths: [
      path.join(HOME, ".claude.json"),
    ],
    instructionPaths: [
      path.join(HOME, ".claude", "CLAUDE.md"),
      path.join(process.cwd(), "CLAUDE.md"),
      path.join(process.cwd(), "AGENTS.md"),
    ],
    format: "json-mcp",
  },
  {
    id: "cursor",
    displayName: "Cursor",
    configPaths: [
      path.join(HOME, ".cursor", "mcp.json"),
    ],
    instructionPaths: [
      path.join(process.cwd(), ".cursorrules"),
      path.join(HOME, ".cursor", "rules.md"),
    ],
    format: "json-mcp",
  },
  {
    id: "windsurf",
    displayName: "Windsurf (Codeium)",
    configPaths: [
      path.join(HOME, ".codeium", "windsurf", "mcp_config.json"),
    ],
    instructionPaths: [
      path.join(HOME, ".codeium", "windsurf", "memories", "global_rules.md"),
    ],
    format: "json-mcp",
  },
  {
    id: "continue",
    displayName: "Continue.dev",
    configPaths: [
      path.join(HOME, ".continue", "config.json"),
      path.join(HOME, ".continue", "config.yaml"),
    ],
    instructionPaths: [
      path.join(HOME, ".continue", "rules", "build-delivery.md"),
    ],
    format: "continue",
    notes: "YAML configs are detected but not auto-edited; we'll write the JSON config alongside.",
  },
  {
    id: "codex",
    displayName: "OpenAI Codex CLI",
    configPaths: [
      path.join(HOME, ".codex", "config.toml"),
    ],
    instructionPaths: [
      path.join(HOME, ".codex", "instructions.md"),
      path.join(process.cwd(), "AGENTS.md"),
    ],
    format: "codex-toml",
  },
  {
    id: "antigravity",
    displayName: "Antigravity (Google)",
    configPaths: [
      path.join(HOME, ".antigravity", "mcp.json"),
      path.join(APPDATA, "Antigravity", "mcp.json"),
    ],
    instructionPaths: [
      path.join(HOME, ".antigravity", "AGENTS.md"),
    ],
    format: "json-mcp",
    notes:
      "Antigravity follows MCP standard; if its config layout differs on your install, " +
      "edit ~/.antigravity/mcp.json by hand.",
  },
];

/**
 * Detect installed agents. An agent is "detected" if any candidate config
 * path or its parent directory exists — we treat parent-directory presence
 * as evidence the agent is installed even when the user hasn't created an
 * MCP config yet.
 */
export async function detectAgents(): Promise<DetectedAgent[]> {
  const results: DetectedAgent[] = [];
  for (const descriptor of AGENTS) {
    const found = await firstExistingPath(descriptor.configPaths);
    if (found) {
      results.push({
        descriptor,
        resolvedConfigPath: found,
        configExists: true,
      });
      continue;
    }
    const parent = await firstExistingParent(descriptor.configPaths);
    if (parent) {
      // The agent's config directory exists; canonical path will be the
      // first candidate.
      results.push({
        descriptor,
        resolvedConfigPath: descriptor.configPaths[0]!,
        configExists: false,
      });
    }
  }
  return results;
}

async function firstExistingPath(candidates: readonly string[]): Promise<string | null> {
  for (const candidate of candidates) {
    if (await fs.pathExists(candidate)) return candidate;
  }
  return null;
}

async function firstExistingParent(candidates: readonly string[]): Promise<string | null> {
  for (const candidate of candidates) {
    const parent = path.dirname(candidate);
    if (await fs.pathExists(parent)) return parent;
  }
  return null;
}

export function findAgentById(id: string): AgentDescriptor | undefined {
  return AGENTS.find((a) => a.id === id);
}
