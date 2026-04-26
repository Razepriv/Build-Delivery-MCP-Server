import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import {
  writeInstruction,
  upsertBlock,
  INSTRUCTION_BLOCK_START,
  INSTRUCTION_BLOCK_END,
} from "../../src/install-agents/instructions.js";

describe("upsertBlock", () => {
  const block = `${INSTRUCTION_BLOCK_START}\nhello\n${INSTRUCTION_BLOCK_END}`;

  it("appends a new block when no markers exist", () => {
    const result = upsertBlock("# CLAUDE.md\n\nExisting content.\n", block);
    expect(result).toContain("Existing content.");
    expect(result).toContain(INSTRUCTION_BLOCK_START);
    expect(result.indexOf(INSTRUCTION_BLOCK_START)).toBeGreaterThan(
      result.indexOf("Existing content."),
    );
  });

  it("replaces an existing block in place", () => {
    const original = `prefix\n${INSTRUCTION_BLOCK_START}\nold content\n${INSTRUCTION_BLOCK_END}\nsuffix\n`;
    const next = upsertBlock(original, block);
    expect(next).toContain("hello");
    expect(next).not.toContain("old content");
    expect(next).toContain("prefix");
    expect(next).toContain("suffix");
  });

  it("handles a malformed (start-only) marker by replacing to EOF", () => {
    const original = `prefix\n${INSTRUCTION_BLOCK_START}\ndangling`;
    const next = upsertBlock(original, block);
    expect(next).toContain("hello");
    expect(next).not.toContain("dangling");
  });

  it("returns the block alone when source is empty", () => {
    expect(upsertBlock("", block)).toContain("hello");
  });
});

describe("writeInstruction", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bdm-instr-"));
  });

  afterAll(async () => {
    await fs.remove(tmpDir);
  });

  it("creates a fresh instructions file when none exists", async () => {
    const file = path.join(tmpDir, "CLAUDE.md");
    const result = await writeInstruction({
      agentId: "claude-code",
      filePath: file,
    });
    expect(result.status).toBe("added");
    const content = await fs.readFile(file, "utf8");
    expect(content).toContain("Auto-deliver builds via build-delivery-mcp");
    expect(content).toContain(INSTRUCTION_BLOCK_START);
  });

  it("idempotent — second run reports unchanged", async () => {
    const file = path.join(tmpDir, "idempotent.md");
    await writeInstruction({ agentId: "cursor", filePath: file });
    const second = await writeInstruction({ agentId: "cursor", filePath: file });
    expect(second.status).toBe("unchanged");
  });

  it("preserves prior content above and below the block", async () => {
    const file = path.join(tmpDir, "preserve.md");
    await fs.writeFile(file, "# My rules\n\nsome rule one\n", "utf8");
    await writeInstruction({ agentId: "claude-code", filePath: file });
    const content = await fs.readFile(file, "utf8");
    expect(content).toContain("My rules");
    expect(content).toContain("some rule one");
    expect(content).toContain("Auto-deliver builds");
  });
});
