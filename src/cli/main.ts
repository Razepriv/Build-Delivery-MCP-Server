#!/usr/bin/env node
/**
 * Unified CLI entry point. Dispatches subcommands; default (no args) runs
 * the MCP server over stdio so `build-delivery-mcp` works as a drop-in
 * `command` value in any agent config.
 *
 *   build-delivery-mcp                      # start the MCP server (stdio)
 *   build-delivery-mcp serve                # explicit form of the above
 *   build-delivery-mcp install-agents ...   # auto-register with detected agents
 *   build-delivery-mcp deliver <file> ...   # one-shot delivery (used by hooks)
 *   build-delivery-mcp setup                # interactive setup wizard
 *   build-delivery-mcp --help
 */
const HELP = `Build Delivery MCP — unified CLI

Usage:
  build-delivery-mcp [command] [...args]

Commands:
  serve                   Start the MCP server over stdio (default).
  install-agents          Auto-register with every detected AI coding agent.
                          Optionally drops a Gradle init script + Xcode snippet.
  deliver <file>          Run the delivery pipeline once. Used by Gradle/Xcode/CI.
  setup                   Interactive setup wizard (channels, profiles, intel).

  -h, --help              Show this help.

Subcommand help:
  build-delivery-mcp install-agents --help
  build-delivery-mcp deliver --help`;

async function main(): Promise<void> {
  const [, , maybeCmd, ...rest] = process.argv;
  const cmd = maybeCmd ?? "serve";

  if (cmd === "-h" || cmd === "--help" || cmd === "help") {
    process.stdout.write(HELP + "\n");
    return;
  }

  // Rewrite argv so subcommand modules see their own args at index 2+.
  process.argv = [process.argv[0]!, process.argv[1]!, ...rest];

  switch (cmd) {
    case "serve":
    case "server":
    case "run": {
      // Default: load the MCP server entry. Importing here keeps the
      // subcommand modules unloaded for non-serve invocations.
      await import(toFileUrl("./../index.js"));
      return;
    }
    case "install-agents":
    case "install": {
      await import(toFileUrl("./install-agents.js"));
      return;
    }
    case "deliver":
    case "send": {
      await import(toFileUrl("./deliver.js"));
      return;
    }
    case "setup":
    case "wizard": {
      await import(toFileUrl("./../setup/wizard.js"));
      return;
    }
    default:
      process.stderr.write(`Unknown command: ${cmd}\n\n${HELP}\n`);
      process.exit(2);
  }
}

function toFileUrl(rel: string): string {
  // Resolve relative to this compiled file. import.meta.url isn't ideal on
  // every platform; this trick lets us load sibling JS without ESM friction.
  const here = new URL(".", import.meta.url);
  return new URL(rel.replace(/^\.\//, ""), here).href;
}

void main();
