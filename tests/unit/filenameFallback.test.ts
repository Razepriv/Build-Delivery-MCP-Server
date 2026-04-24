import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import { filenameFallback } from "../../src/parser/filenameFallback.js";

describe("filenameFallback", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bdm-"));
  });

  afterAll(async () => {
    await fs.remove(tmpDir);
  });

  it("derives app name, version, and build type from filename", async () => {
    const f = path.join(tmpDir, "seri_mediclinic_v2.4.1_release.apk");
    await fs.writeFile(f, "fake");
    const meta = await filenameFallback(f);
    expect(meta.appName).toBe("seri_mediclinic");
    expect(meta.versionName).toBe("2.4.1");
    expect(meta.buildType).toBe("release");
    expect(meta.source).toBe("filename-fallback");
  });

  it("falls back to unknown build type without hints", async () => {
    const f = path.join(tmpDir, "app-3.0.0.apk");
    await fs.writeFile(f, "fake");
    const meta = await filenameFallback(f);
    expect(meta.buildType).toBe("unknown");
    expect(meta.versionName).toBe("3.0.0");
  });

  it("reports 0.0.0 when no version is present", async () => {
    const f = path.join(tmpDir, "mystery.apk");
    await fs.writeFile(f, "fake");
    const meta = await filenameFallback(f);
    expect(meta.versionName).toBe("0.0.0");
  });
});
