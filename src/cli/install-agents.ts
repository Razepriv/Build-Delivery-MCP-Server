#!/usr/bin/env node
/**
 * build-delivery-mcp install-agents — auto-register the MCP server with
 * every detected AI coding agent on this machine, optionally drop a
 * Gradle init script that pipes every Android build through the
 * delivery pipeline, and optionally inject a "use this MCP for builds"
 * instruction into each agent's rules file.
 *
 * Usage:
 *   build-delivery-mcp install-agents               # interactive
 *   build-delivery-mcp install-agents --yes         # non-interactive, all detected
 *   build-delivery-mcp install-agents --dry-run     # show diff, write nothing
 *   build-delivery-mcp install-agents --only cursor,claude-code
 *   build-delivery-mcp install-agents --no-instructions
 *   build-delivery-mcp install-agents --no-build-hooks
 *   build-delivery-mcp install-agents --uninstall   # remove all entries
 */
import "dotenv/config";
import readline from "node:readline/promises";
import path from "node:path";
import os from "node:os";
import { stdin as input, stdout as output } from "node:process";
import fs from "fs-extra";
import { detectAgents } from "../install-agents/detector.js";
import {
  buildMcpEntry,
  installAgents,
  type InstallReport,
} from "../install-agents/install.js";
import {
  INSTRUCTION_BLOCK_END,
  INSTRUCTION_BLOCK_START,
} from "../install-agents/instructions.js";
import { xcodePostBuildScript } from "../install-agents/build-hooks/xcode.js";

interface CliOptions {
  yes: boolean;
  dryRun: boolean;
  only?: string[];
  writeInstructions: boolean;
  writeBuildHooks: boolean;
  uninstall: boolean;
  serverPath?: string;
  configPath?: string;
  help: boolean;
}

function parseCliArgs(argv: readonly string[]): CliOptions {
  const opts: CliOptions = {
    yes: false,
    dryRun: false,
    writeInstructions: true,
    writeBuildHooks: true,
    uninstall: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    switch (arg) {
      case "-h":
      case "--help":
        opts.help = true;
        break;
      case "-y":
      case "--yes":
        opts.yes = true;
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--no-instructions":
        opts.writeInstructions = false;
        break;
      case "--no-build-hooks":
        opts.writeBuildHooks = false;
        break;
      case "--uninstall":
        opts.uninstall = true;
        break;
      case "--only":
        opts.only = (argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        break;
      case "--server":
        opts.serverPath = argv[++i];
        break;
      case "--config":
        opts.configPath = argv[++i];
        break;
      default:
        // ignore positional args
        break;
    }
  }
  return opts;
}

function help(): string {
  return `build-delivery-mcp install-agents

Detects AI coding agents on this machine (Claude Desktop, Claude Code, Cursor,
Windsurf, Continue, Codex CLI, Antigravity) and registers the build-delivery
MCP server with each. Optionally writes:
  • an auto-deliver instruction block into each agent's rules file
  • a Gradle init script (~/.gradle/init.d/build-delivery-mcp.gradle) so
    every Android build pipes through the delivery pipeline
  • an Xcode post-build snippet (printed to stdout for manual use)

Options:
  -y, --yes               Non-interactive; install for every detected agent
      --dry-run           Show what would change; don't write anything
      --only <ids>        Comma-separated agent ids to limit to
      --no-instructions   Skip writing auto-deliver instructions
      --no-build-hooks    Skip writing the Gradle init script
      --uninstall         Remove the build-delivery entry from every agent
      --server <path>     Override path to dist/index.js
      --config <path>     Embed CONFIG_PATH=<path> in the agent env block
  -h, --help              Show this help

Examples:
  build-delivery-mcp install-agents
  build-delivery-mcp install-agents --dry-run
  build-delivery-mcp install-agents --only cursor,claude-code -y`;
}

async function main(): Promise<void> {
  const opts = parseCliArgs(process.argv.slice(2));
  if (opts.help) {
    output.write(help() + "\n");
    process.exit(0);
  }

  if (opts.uninstall) {
    await runUninstall(opts);
    return;
  }

  const detected = await detectAgents();
  if (detected.length === 0) {
    output.write(
      "No supported agents detected on this machine.\n" +
        "Supported targets: Claude Desktop, Claude Code, Cursor, Windsurf, Continue, Codex CLI, Antigravity.\n",
    );
    process.exit(0);
  }

  output.write("\nDetected agents:\n");
  for (const d of detected) {
    output.write(`  • ${d.descriptor.displayName.padEnd(22)} → ${d.resolvedConfigPath}${d.configExists ? "" : "  (will create)"}\n`);
  }

  let chosenIds = opts.only ?? detected.map((d) => d.descriptor.id);
  if (!opts.yes && !opts.only) {
    const rl = readline.createInterface({ input, output });
    try {
      const answer = (
        await rl.question("\nInstall MCP entry for ALL detected agents? [Y/n/list]: ")
      ).trim().toLowerCase();
      if (answer === "n" || answer === "no") {
        process.exit(0);
      }
      if (answer === "list" || answer === "l") {
        const which = (await rl.question("Comma-separated ids: ")).trim();
        chosenIds = which.split(",").map((s) => s.trim()).filter(Boolean);
      }
    } finally {
      rl.close();
    }
  }

  const env: Record<string, string> = {};
  if (opts.configPath) env.CONFIG_PATH = path.resolve(opts.configPath);
  const entry = buildMcpEntry({
    serverEntryPath: opts.serverPath,
    env: Object.keys(env).length > 0 ? env : undefined,
  });

  const deliverCommand = await resolveDeliverCommand(opts.serverPath);
  const report = await installAgents({
    entry,
    writeInstructions: opts.writeInstructions,
    writeBuildHooks: opts.writeBuildHooks,
    deliverCommand,
    dryRun: opts.dryRun,
    only: chosenIds,
  });

  printReport(report, opts.dryRun);

  // Always emit the Xcode snippet for users who want to opt in.
  if (opts.writeBuildHooks) {
    const snippetPath = path.join(os.homedir(), ".build-delivery", "xcode-post-build.sh");
    if (!opts.dryRun) {
      await fs.ensureDir(path.dirname(snippetPath));
      await fs.writeFile(snippetPath, xcodePostBuildScript(deliverCommand), "utf8");
    }
    output.write(
      `\nXcode snippet${opts.dryRun ? " (dry-run, not written)" : ""}: ${snippetPath}\n` +
        "  → Paste this into a Run Script Build Phase or Archive post-action.\n",
    );
  }

  output.write("\nDone.\n");
}

function printReport(report: InstallReport, dryRun: boolean): void {
  const tag = dryRun ? "[dry-run] " : "";
  output.write("\nMCP entry results:\n");
  for (const r of report.mcpOutcomes) {
    output.write(`  ${tag}${r.agentId.padEnd(18)} ${r.status.padEnd(10)} ${r.path}\n`);
    if (r.backupPath) output.write(`      backup: ${r.backupPath}\n`);
    if (r.message) output.write(`      ${r.message}\n`);
  }
  if (report.instructionOutcomes.length > 0) {
    output.write("\nInstruction file results:\n");
    for (const r of report.instructionOutcomes) {
      output.write(`  ${tag}${r.agentId.padEnd(18)} ${r.status.padEnd(10)} ${r.path}\n`);
    }
  }
  if (report.buildHookOutcomes.length > 0) {
    output.write("\nBuild-hook results:\n");
    for (const r of report.buildHookOutcomes) {
      output.write(`  ${tag}gradle              ${r.status.padEnd(10)} ${r.path}\n`);
      if (r.backupPath) output.write(`      backup: ${r.backupPath}\n`);
    }
  }
}

async function runUninstall(opts: CliOptions): Promise<void> {
  const detected = await detectAgents();
  const targets = opts.only
    ? detected.filter((d) => opts.only!.includes(d.descriptor.id))
    : detected;
  for (const t of targets) {
    if (!t.configExists) continue;
    if (t.descriptor.format === "codex-toml") {
      await uninstallCodexEntry(t.resolvedConfigPath, opts.dryRun);
    } else {
      await uninstallJsonEntry(t.resolvedConfigPath, opts.dryRun);
    }
    for (const ip of t.descriptor.instructionPaths) {
      await uninstallInstructionBlock(ip, opts.dryRun);
    }
    output.write(`  ${opts.dryRun ? "[dry-run] " : ""}${t.descriptor.id.padEnd(18)} cleaned ${t.resolvedConfigPath}\n`);
  }
  output.write("\nDone.\n");
}

async function uninstallJsonEntry(filePath: string, dryRun: boolean): Promise<void> {
  if (!(await fs.pathExists(filePath))) return;
  const raw = await fs.readFile(filePath, "utf8");
  if (!raw.trim()) return;
  try {
    const parsed = JSON.parse(raw) as { mcpServers?: Record<string, unknown> };
    if (!parsed.mcpServers || !parsed.mcpServers["build-delivery"]) return;
    const next = { ...parsed, mcpServers: { ...parsed.mcpServers } };
    delete (next.mcpServers as Record<string, unknown>)["build-delivery"];
    if (!dryRun) {
      await fs.writeFile(filePath, JSON.stringify(next, null, 2) + "\n", "utf8");
    }
  } catch {
    // ignore parse error — leave alone
  }
}

async function uninstallCodexEntry(filePath: string, dryRun: boolean): Promise<void> {
  if (!(await fs.pathExists(filePath))) return;
  const raw = await fs.readFile(filePath, "utf8");
  const stripped = raw.replace(
    /^\[mcp_servers\.build-delivery\][\s\S]*?(?=^\[|\Z)/m,
    "",
  );
  if (stripped !== raw && !dryRun) {
    await fs.writeFile(filePath, stripped, "utf8");
  }
}

async function uninstallInstructionBlock(
  filePath: string,
  dryRun: boolean,
): Promise<void> {
  if (!(await fs.pathExists(filePath))) return;
  const raw = await fs.readFile(filePath, "utf8");
  const startIdx = raw.indexOf(INSTRUCTION_BLOCK_START);
  const endIdx = raw.indexOf(INSTRUCTION_BLOCK_END);
  if (startIdx === -1 || endIdx === -1) return;
  const before = raw.slice(0, startIdx).replace(/\s+$/, "");
  const after = raw.slice(endIdx + INSTRUCTION_BLOCK_END.length).replace(/^\s+/, "");
  const next = `${before}\n${after}`.trimStart();
  if (!dryRun) {
    await fs.writeFile(filePath, next, "utf8");
  }
}

async function resolveDeliverCommand(serverPath?: string): Promise<string> {
  // Prefer the published global binary; fall back to `node <abs deliver.js>`.
  const here = new URL("../", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
  const distDeliver = path.join(here, "..", "dist", "cli", "deliver.js");
  const resolved = await fs.pathExists(distDeliver)
    ? `node "${distDeliver}"`
    : "build-delivery-mcp deliver";
  return serverPath ? `node "${path.resolve(serverPath, "..", "cli", "deliver.js")}"` : resolved;
}

main().catch((err) => {
  process.stderr.write(`install-agents failed: ${(err as Error).message}\n`);
  process.exit(1);
});
