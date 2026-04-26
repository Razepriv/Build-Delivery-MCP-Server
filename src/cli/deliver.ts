#!/usr/bin/env node
/**
 * Headless single-shot delivery CLI.
 *
 *   build-delivery-mcp deliver <file> [--profile <name>] [--tags qa,internal]
 *                                     [--channels telegram,slack]
 *                                     [--message "Build #241 ready"]
 *                                     [--app-name "Override"] [--version "2.4.1"]
 *
 * This is the binary that Gradle/Xcode/CI hooks invoke. It runs the
 * full pipeline once and exits 0 on at least one successful delivery,
 * 2 on validation error, 3 on full failure.
 */
import "dotenv/config";
import path from "node:path";
import fs from "fs-extra";
import { ConfigStore } from "../config/store.js";
import { BuildHistory } from "../history/buildHistory.js";
import { DeliveryPipeline } from "../pipeline.js";
import { TokenStore } from "../install-tracking/tokenStore.js";
import type { ChannelName } from "../types.js";
import { logger } from "../utils/logger.js";

interface ParsedArgs {
  filePath?: string;
  profile?: string;
  tags?: string[];
  channels?: ChannelName[];
  message?: string;
  appName?: string;
  version?: string;
  help?: boolean;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const out: ParsedArgs = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg === "--profile") {
      out.profile = argv[++i];
      continue;
    }
    if (arg === "--tags") {
      out.tags = (argv[++i] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      continue;
    }
    if (arg === "--channels") {
      out.channels = (argv[++i] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean) as ChannelName[];
      continue;
    }
    if (arg === "--message") {
      out.message = argv[++i];
      continue;
    }
    if (arg === "--app-name") {
      out.appName = argv[++i];
      continue;
    }
    if (arg === "--version") {
      out.version = argv[++i];
      continue;
    }
    if (!out.filePath && !arg.startsWith("--")) {
      out.filePath = arg;
    }
  }
  return out;
}

function usage(): string {
  return `build-delivery-mcp deliver — single-shot pipeline runner

Usage:
  build-delivery-mcp deliver <file> [options]

Options:
  --profile <name>          Target profile (default: default)
  --tags qa,internal        Restrict delivery to recipients with any of these tags
  --channels telegram,slack Restrict to specific channels
  --message "..."           Custom caption suffix
  --app-name "..."          Override parsed app name
  --version "..."           Override parsed version
  -h, --help                Print this help

Exit codes:
  0   at least one recipient delivered successfully
  2   invalid arguments
  3   no recipient delivered successfully`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage() + "\n");
    process.exit(0);
  }
  if (!args.filePath) {
    process.stderr.write("Error: file path required.\n\n" + usage() + "\n");
    process.exit(2);
  }
  const absolutePath = path.resolve(args.filePath);
  if (!(await fs.pathExists(absolutePath))) {
    process.stderr.write(`Error: file not found: ${absolutePath}\n`);
    process.exit(2);
  }

  const config = await ConfigStore.load();
  const history = new BuildHistory(50);
  const pipeline = new DeliveryPipeline(config, history);

  // Reuse the running tracker if the user has one wired up; otherwise the
  // deliver CLI runs without tracking (links won't be in captions).
  try {
    const { profile } = config.resolveProfile(args.profile);
    if (profile.intel.tracking.enabled) {
      const store = new TokenStore(
        profile.intel.tracking.eventLogPath ?? "./.tracking/events.jsonl",
      );
      await store.init();
      pipeline.setTokenStore(store);
    }
  } catch (err) {
    logger.debug(`Tracking init skipped: ${(err as Error).message}`);
  }

  try {
    const outcome = await pipeline.process({
      filePath: absolutePath,
      profile: args.profile,
      tags: args.tags,
      channels: args.channels,
      customMessage: args.message,
      appName: args.appName,
      version: args.version,
    });
    const successCount = outcome.results.filter((r) => r.success).length;
    process.stdout.write(
      JSON.stringify(
        {
          ok: successCount > 0,
          successCount,
          totalRecipients: outcome.results.length,
          totalMs: outcome.totalMs,
          stagedFilename: outcome.stagedFilename,
          metadata: outcome.entry.metadata,
          results: outcome.results,
        },
        null,
        2,
      ) + "\n",
    );
    process.exit(successCount > 0 ? 0 : 3);
  } catch (err) {
    process.stderr.write(`deliver failed: ${(err as Error).message}\n`);
    process.exit(3);
  } finally {
    await pipeline.shutdown();
  }
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
