import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import { writeCodexToml } from "../../src/install-agents/writers/codex.js";

describe("writeCodexToml", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bdm-codex-"));
  });

  afterAll(async () => {
    await fs.remove(tmpDir);
  });

  it("appends a new [mcp_servers.<name>] table to existing config", async () => {
    const file = path.join(tmpDir, "config.toml");
    await fs.writeFile(file, '[user]\nname = "alice"\n', "utf8");
    const result = await writeCodexToml({
      agentId: "codex",
      filePath: file,
      entryName: "build-delivery",
      entry: { command: "node", args: ["/abs/path/index.js"] },
    });
    expect(result.status).toBe("updated");
    const next = await fs.readFile(file, "utf8");
    expect(next).toContain('[user]');
    expect(next).toContain('[mcp_servers.build-delivery]');
    expect(next).toContain('command = "node"');
    expect(next).toContain('args = ["/abs/path/index.js"]');
  });

  it("creates a new file when none exists", async () => {
    const file = path.join(tmpDir, "fresh.toml");
    const result = await writeCodexToml({
      agentId: "codex",
      filePath: file,
      entryName: "build-delivery",
      entry: { command: "node", args: ["/x.js"] },
    });
    expect(result.status).toBe("added");
    const content = await fs.readFile(file, "utf8");
    expect(content).toContain("[mcp_servers.build-delivery]");
  });

  it("replaces the table on update without duplicating", async () => {
    const file = path.join(tmpDir, "replace.toml");
    await writeCodexToml({
      agentId: "codex",
      filePath: file,
      entryName: "build-delivery",
      entry: { command: "node", args: ["/old.js"] },
    });
    await writeCodexToml({
      agentId: "codex",
      filePath: file,
      entryName: "build-delivery",
      entry: { command: "node", args: ["/new.js"] },
    });
    const content = await fs.readFile(file, "utf8");
    const occurrences = content.match(/\[mcp_servers\.build-delivery\]/g) ?? [];
    expect(occurrences.length).toBe(1);
    expect(content).toContain("/new.js");
    expect(content).not.toContain("/old.js");
  });

  it("escapes quotes and backslashes in values", async () => {
    const file = path.join(tmpDir, "escape.toml");
    await writeCodexToml({
      agentId: "codex",
      filePath: file,
      entryName: "build-delivery",
      entry: {
        command: "node",
        args: ['C:\\path with "spaces"\\index.js'],
        env: { CONFIG_PATH: 'with"quote' },
      },
    });
    const content = await fs.readFile(file, "utf8");
    expect(content).toContain('\\"spaces\\"');
    expect(content).toContain("CONFIG_PATH");
  });
});
