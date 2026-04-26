import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import { TokenStore } from "../../src/install-tracking/tokenStore.js";

describe("TokenStore", () => {
  let tmpDir: string;
  let store: TokenStore;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bdm-token-"));
    store = new TokenStore(path.join(tmpDir, "events.jsonl"));
    await store.init();
  });

  afterAll(async () => {
    await fs.remove(tmpDir);
  });

  it("issues a hex token of the expected length", () => {
    const record = store.issue({
      filePath: "/tmp/build.apk",
      filename: "build.apk",
      profile: "default",
      buildId: "b1",
      ttlHours: 1,
    });
    expect(record.token).toMatch(/^[0-9a-f]{48}$/);
  });

  it("resolves an issued token and decodes its record", () => {
    const record = store.issue({
      filePath: "/tmp/build.apk",
      filename: "build.apk",
      profile: "default",
      buildId: "b2",
      ttlHours: 1,
    });
    const resolved = store.resolve(record.token);
    expect(resolved).not.toBeNull();
    expect(resolved!.buildId).toBe("b2");
  });

  it("returns null for an unknown token", () => {
    expect(store.resolve("0".repeat(48))).toBeNull();
  });

  it("returns null for a malformed token", () => {
    expect(store.resolve("not-hex")).toBeNull();
    expect(store.resolve("")).toBeNull();
    expect(store.resolve("a".repeat(50))).toBeNull();
  });

  it("evicts expired tokens on access", async () => {
    const record = store.issue({
      filePath: "/tmp/build.apk",
      filename: "build.apk",
      profile: "default",
      buildId: "b3",
      ttlHours: 0,
    });
    // ttlHours=0 → expiresAt === issuedAt; bump time forward by sleeping a tick
    await new Promise((r) => setTimeout(r, 5));
    expect(store.resolve(record.token)).toBeNull();
  });

  it("appends events to the json-lines log and reads them back", async () => {
    store.recordEvent({
      timestamp: Date.now(),
      token: "a".repeat(48),
      buildId: "b1",
      profile: "default",
      ip: "127.0.0.1",
      kind: "click",
    });
    store.recordEvent({
      timestamp: Date.now(),
      token: "b".repeat(48),
      buildId: "b2",
      profile: "default",
      kind: "download",
    });
    // Wait for the queued writes to flush.
    await new Promise((r) => setTimeout(r, 50));
    const events = await store.readEvents(10);
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0]!.kind).toBe("download"); // newest first
  });
});
