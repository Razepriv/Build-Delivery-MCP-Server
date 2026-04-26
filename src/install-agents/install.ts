import path from "node:path";
import fs from "fs-extra";
import type {
  AgentDescriptor,
  DetectedAgent,
  InstallOutcome,
  McpServerEntry,
} from "./types.js";
import { detectAgents } from "./detector.js";
import { writeJsonMcp } from "./writers/json-mcp.js";
import { writeContinue } from "./writers/continue.js";
import { writeCodexToml } from "./writers/codex.js";
import { writeInstruction } from "./instructions.js";
import { installGradleHook } from "./build-hooks/gradle.js";
import { logger } from "../utils/logger.js";

export interface BuildEntryOptions {
  /** Override the bin name embedded in the MCP entry. */
  readonly entryName?: string;
  /** Absolute path to dist/index.js. Defaults to the file co-located with this module. */
  readonly serverEntryPath?: string;
  /** Extra env vars to embed in the agent config (e.g. CONFIG_PATH). */
  readonly env?: Readonly<Record<string, string>>;
  /** Override the node binary. */
  readonly nodeBinary?: string;
}

const DEFAULT_ENTRY_NAME = "build-delivery";

function resolveServerEntry(override?: string): string {
  if (override) return path.resolve(override);
  // When the package is installed, dist/install-agents/install.js sits next
  // to dist/index.js. When run from source via tsx, walk up from src/.
  const here = new URL("../../", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
  const distIndex = path.join(here, "dist", "index.js");
  return distIndex;
}

export function buildMcpEntry(options: BuildEntryOptions = {}): McpServerEntry {
  const entry: McpServerEntry = {
    command: options.nodeBinary ?? "node",
    args: [resolveServerEntry(options.serverEntryPath)],
    env: options.env,
  };
  return entry;
}

export interface InstallAgentsOptions {
  readonly entryName?: string;
  readonly entry: McpServerEntry;
  readonly writeInstructions?: boolean;
  readonly writeBuildHooks?: boolean;
  readonly deliverCommand?: string;
  readonly dryRun?: boolean;
  /** When provided, restricts to agents with matching ids. */
  readonly only?: readonly string[];
}

export interface InstallReport {
  readonly detected: readonly DetectedAgent[];
  readonly mcpOutcomes: readonly InstallOutcome[];
  readonly instructionOutcomes: readonly InstallOutcome[];
  readonly buildHookOutcomes: readonly InstallOutcome[];
}

export async function installAgents(
  options: InstallAgentsOptions,
): Promise<InstallReport> {
  const detected = await detectAgents();
  const filtered = options.only
    ? detected.filter((d) => options.only!.includes(d.descriptor.id))
    : detected;

  const entryName = options.entryName ?? DEFAULT_ENTRY_NAME;
  const mcpOutcomes: InstallOutcome[] = [];
  const instructionOutcomes: InstallOutcome[] = [];
  const buildHookOutcomes: InstallOutcome[] = [];

  for (const target of filtered) {
    const outcome = await writeForAgent(target.descriptor, target.resolvedConfigPath, {
      entryName,
      entry: options.entry,
      dryRun: options.dryRun,
    });
    mcpOutcomes.push(outcome);
  }

  if (options.writeInstructions !== false) {
    for (const target of filtered) {
      for (const ip of target.descriptor.instructionPaths) {
        const dir = path.dirname(ip);
        if (!(await fs.pathExists(dir))) continue; // don't manufacture rule dirs
        const outcome = await writeInstruction({
          agentId: target.descriptor.id,
          filePath: ip,
          dryRun: options.dryRun,
        });
        instructionOutcomes.push(outcome);
      }
    }
  }

  if (options.writeBuildHooks && options.deliverCommand) {
    const gradle = await installGradleHook({
      deliverCommand: options.deliverCommand,
      dryRun: options.dryRun,
    });
    buildHookOutcomes.push(gradle);
  }

  return {
    detected: filtered,
    mcpOutcomes,
    instructionOutcomes,
    buildHookOutcomes,
  };
}

async function writeForAgent(
  descriptor: AgentDescriptor,
  filePath: string,
  options: { entryName: string; entry: McpServerEntry; dryRun?: boolean },
): Promise<InstallOutcome> {
  try {
    switch (descriptor.format) {
      case "json-mcp":
        return await writeJsonMcp({
          agentId: descriptor.id,
          filePath,
          entryName: options.entryName,
          entry: options.entry,
          dryRun: options.dryRun,
        });
      case "continue":
        return await writeContinue({
          agentId: descriptor.id,
          filePath,
          entryName: options.entryName,
          entry: options.entry,
          dryRun: options.dryRun,
        });
      case "codex-toml":
        return await writeCodexToml({
          agentId: descriptor.id,
          filePath,
          entryName: options.entryName,
          entry: options.entry,
          dryRun: options.dryRun,
        });
    }
  } catch (err) {
    logger.error(`Install failed for ${descriptor.id}: ${(err as Error).message}`);
    return {
      agentId: descriptor.id,
      path: filePath,
      status: "error",
      message: (err as Error).message,
    };
  }
}
