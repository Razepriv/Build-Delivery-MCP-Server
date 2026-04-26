import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import { writeContinue } from "../../src/install-agents/writers/continue.js";

describe("writeContinue", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bdm-continue-"));
  });

  afterAll(async () => {
    await fs.remove(tmpDir);
  });

  it("writes both modern mcpServers and legacy experimental array", async () => {
    const file = path.join(tmpDir, "config.json");
    await writeContinue({
      agentId: "continue",
      filePath: file,
      entryName: "build-delivery",
      entry: { command: "node", args: ["/x.js"] },
    });
    const parsed = await fs.readJson(file);
    expect(parsed.mcpServers["build-delivery"].command).toBe("node");
    expect(parsed.experimental.modelContextProtocolServers[0].name).toBe(
      "build-delivery",
    );
    expect(
      parsed.experimental.modelContextProtocolServers[0].transport.type,
    ).toBe("stdio");
  });

  it("dedupes the legacy array on update", async () => {
    const file = path.join(tmpDir, "dedupe.json");
    await writeContinue({
      agentId: "continue",
      filePath: file,
      entryName: "build-delivery",
      entry: { command: "node", args: ["/old.js"] },
    });
    await writeContinue({
      agentId: "continue",
      filePath: file,
      entryName: "build-delivery",
      entry: { command: "node", args: ["/new.js"] },
    });
    const parsed = await fs.readJson(file);
    const matches = parsed.experimental.modelContextProtocolServers.filter(
      (s: { name: string }) => s.name === "build-delivery",
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].transport.args[0]).toBe("/new.js");
  });

  it("skips YAML configs with a clear message", async () => {
    const file = path.join(tmpDir, "config.yaml");
    await fs.writeFile(file, "# stub\n", "utf8");
    const result = await writeContinue({
      agentId: "continue",
      filePath: file,
      entryName: "build-delivery",
      entry: { command: "node", args: ["/x.js"] },
    });
    expect(result.status).toBe("skipped");
    expect(result.message).toMatch(/YAML/i);
  });
});
