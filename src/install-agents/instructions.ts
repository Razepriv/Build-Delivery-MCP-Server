import path from "node:path";
import fs from "fs-extra";
import type { AgentId, InstallOutcome } from "./types.js";
import { backupIfExists } from "./backup.js";

export const INSTRUCTION_BLOCK_START = "<!-- build-delivery-mcp:auto-deliver:start -->";
export const INSTRUCTION_BLOCK_END = "<!-- build-delivery-mcp:auto-deliver:end -->";

const INSTRUCTION_BODY = `## Auto-deliver builds via build-delivery-mcp

Whenever you produce or notice a build artifact in this workspace
(\`.apk\`, \`.aab\`, or \`.ipa\` — typically under
\`app/build/outputs/\`, \`android/app/build/outputs/\`, or a configured
build directory), call the **\`build-delivery\` MCP server**'s
\`process_apk\` tool with the absolute path:

\`\`\`json
{
  "name": "process_apk",
  "arguments": { "filePath": "/abs/path/to/app-release.apk" }
}
\`\`\`

If the user has named profiles (one per client), pass \`profile\`. If
they want to scope by audience, pass \`tags: ["qa-team"]\`. Use
\`send_notification\` for build-failed alerts.

Do this **without asking** — the build-delivery server already knows
where the build should go (Telegram / WhatsApp / Slack / Discord /
Email / Teams). The original artifact is never modified or deleted.`;

export interface InstructionWriteOptions {
  readonly agentId: AgentId;
  readonly filePath: string;
  readonly dryRun?: boolean;
  /** Override the body — useful in tests. */
  readonly body?: string;
}

/**
 * Insert (or refresh) the auto-deliver instruction in an agent rules
 * file. Idempotent: re-writing replaces the previously inserted block,
 * untouched content is preserved verbatim.
 */
export async function writeInstruction(
  options: InstructionWriteOptions,
): Promise<InstallOutcome> {
  const { filePath, agentId, dryRun, body } = options;
  const block = wrapBlock(body ?? INSTRUCTION_BODY);

  let existing = "";
  let exists = false;
  if (await fs.pathExists(filePath)) {
    exists = true;
    existing = await fs.readFile(filePath, "utf8");
  }

  const next = upsertBlock(existing, block);
  if (next === existing) {
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

function wrapBlock(body: string): string {
  return `${INSTRUCTION_BLOCK_START}\n${body.trim()}\n${INSTRUCTION_BLOCK_END}`;
}

export function upsertBlock(source: string, block: string): string {
  const startIdx = source.indexOf(INSTRUCTION_BLOCK_START);
  if (startIdx === -1) {
    if (source.trim().length === 0) return `${block}\n`;
    const sep = source.endsWith("\n") ? "\n" : "\n\n";
    return `${source}${sep}${block}\n`;
  }
  const endIdx = source.indexOf(INSTRUCTION_BLOCK_END, startIdx);
  if (endIdx === -1) {
    // Malformed: leading marker but no trailing one. Replace from start
    // marker to end of file with the new block.
    return source.slice(0, startIdx) + block + "\n";
  }
  const after = endIdx + INSTRUCTION_BLOCK_END.length;
  const before = source.slice(0, startIdx);
  const tail = source.slice(after);
  return `${before}${block}${tail.startsWith("\n") ? tail : `\n${tail}`}`;
}
