import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import { writeJsonMcp } from "../../src/install-agents/writers/json-mcp.js";

describe("writeJsonMcp", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bdm-jsonmcp-"));
  });

  afterAll(async () => {
    await fs.remove(tmpDir);
  });

  it("creates a fresh config when none exists", async () => {
    const file = path.join(tmpDir, "claude_desktop_config.json");
    const result = await writeJsonMcp({
      agentId: "claude-desktop",
      filePath: file,
      entryName: "build-delivery",
      entry: { command: "node", args: ["/abs/path/dist/index.js"] },
    });
    expect(result.status).toBe("added");
    expect(result.backupPath).toBeUndefined();
    const parsed = await fs.readJson(file);
    expect(parsed.mcpServers["build-delivery"].command).toBe("node");
  });

  it("preserves unrelated keys and other mcpServers entries", async () => {
    const file = path.join(tmpDir, "preserve.json");
    await fs.writeJson(file, {
      otherKey: { foo: "bar" },
      mcpServers: {
        existing: { command: "py", args: ["-m", "x"] },
      },
    });
    await writeJsonMcp({
      agentId: "cursor",
      filePath: file,
      entryName: "build-delivery",
      entry: { command: "node", args: ["/abs/path/dist/index.js"] },
    });
    const parsed = await fs.readJson(file);
    expect(parsed.otherKey).toEqual({ foo: "bar" });
    expect(parsed.mcpServers.existing.command).toBe("py");
    expect(parsed.mcpServers["build-delivery"].command).toBe("node");
  });

  it("is idempotent — second run reports unchanged with no backup", async () => {
    const file = path.join(tmpDir, "idempotent.json");
    await writeJsonMcp({
      agentId: "claude-code",
      filePath: file,
      entryName: "build-delivery",
      entry: { command: "node", args: ["/abs/path/dist/index.js"] },
    });
    const second = await writeJsonMcp({
      agentId: "claude-code",
      filePath: file,
      entryName: "build-delivery",
      entry: { command: "node", args: ["/abs/path/dist/index.js"] },
    });
    expect(second.status).toBe("unchanged");
    expect(second.backupPath).toBeUndefined();
  });

  it("backs up the existing config when content changes", async () => {
    const file = path.join(tmpDir, "backup.json");
    await fs.writeJson(file, {
      mcpServers: {
        "build-delivery": { command: "node", args: ["/old/path/index.js"] },
      },
    });
    const result = await writeJsonMcp({
      agentId: "claude-desktop",
      filePath: file,
      entryName: "build-delivery",
      entry: { command: "node", args: ["/new/path/index.js"] },
    });
    expect(result.status).toBe("updated");
    expect(result.backupPath).toBeDefined();
    expect(await fs.pathExists(result.backupPath!)).toBe(true);
    const parsed = await fs.readJson(file);
    expect(parsed.mcpServers["build-delivery"].args[0]).toBe("/new/path/index.js");
  });

  it("dry-run returns the would-be status without writing", async () => {
    const file = path.join(tmpDir, "dryrun.json");
    const result = await writeJsonMcp({
      agentId: "windsurf",
      filePath: file,
      entryName: "build-delivery",
      entry: { command: "node", args: ["/x.js"] },
      dryRun: true,
    });
    expect(result.status).toBe("added");
    expect(await fs.pathExists(file)).toBe(false);
  });

  it("returns error on malformed existing JSON", async () => {
    const file = path.join(tmpDir, "broken.json");
    await fs.writeFile(file, "{ this is not: valid json", "utf8");
    const result = await writeJsonMcp({
      agentId: "claude-desktop",
      filePath: file,
      entryName: "build-delivery",
      entry: { command: "node", args: ["/x.js"] },
    });
    expect(result.status).toBe("error");
  });
});
