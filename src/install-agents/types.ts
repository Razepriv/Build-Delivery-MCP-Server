export type AgentId =
  | "claude-desktop"
  | "claude-code"
  | "cursor"
  | "windsurf"
  | "continue"
  | "codex"
  | "antigravity";

export interface AgentDescriptor {
  readonly id: AgentId;
  readonly displayName: string;
  /**
   * Candidate config paths in priority order. The first one that exists
   * wins; the first one in the list is also the canonical creation path
   * when none exist yet.
   */
  readonly configPaths: readonly string[];
  /** Where this agent stores its system instructions (CLAUDE.md, AGENTS.md, etc.). */
  readonly instructionPaths: readonly string[];
  readonly format: "json-mcp" | "continue" | "codex-toml";
  readonly notes?: string;
}

export interface DetectedAgent {
  readonly descriptor: AgentDescriptor;
  /** First existing configPath, or the canonical path if none exist. */
  readonly resolvedConfigPath: string;
  readonly configExists: boolean;
}

export interface McpServerEntry {
  readonly command: string;
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}

export interface InstallPlan {
  readonly entryName: string;
  readonly entry: McpServerEntry;
  readonly writeInstructions: boolean;
  readonly writeBuildHooks: boolean;
}

export type InstallStatus = "added" | "updated" | "unchanged" | "skipped" | "error";

export interface InstallOutcome {
  readonly agentId: AgentId;
  readonly path: string;
  readonly status: InstallStatus;
  readonly backupPath?: string;
  readonly message?: string;
}
