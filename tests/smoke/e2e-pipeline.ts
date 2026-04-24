/**
 * End-to-end smoke test.
 *
 * Exercises: ConfigStore bootstrap → DeliveryPipeline → parse → rename →
 * delivery attempt (expected to fail harmlessly because no real bot token
 * is configured) → history append → clean shutdown.
 *
 * Success criteria: no crash, history captures the entry, original file
 * is preserved on disk after the run.
 */
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import { ConfigStore } from "../../src/config/store.js";
import { BuildHistory } from "../../src/history/buildHistory.js";
import { DeliveryPipeline } from "../../src/pipeline.js";

async function main() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "bdm-smoke-"));
  const configPath = path.join(tmp, "config.json");
  const stagingDir = path.join(tmp, ".staging");
  const watchDir = path.join(tmp, "builds");
  await fs.ensureDir(watchDir);
  process.env.CONFIG_PATH = configPath;
  process.env.STAGING_DIR = stagingDir;

  // Seed a fake APK — binary content is meaningless for the fallback parser.
  const apkPath = path.join(watchDir, "seri_mediclinic_v2.4.1_release.apk");
  await fs.writeFile(apkPath, Buffer.alloc(1024, 0xaa));
  const originalSize = (await fs.stat(apkPath)).size;

  const config = await ConfigStore.load(configPath);
  // Force a profile with no real credentials so delivery fails predictably.
  await config.upsertProfile("smoke", {
    defaultChannel: "telegram",
    telegram: { enabled: true, botToken: "SMOKE_INVALID_TOKEN", chatIds: ["1"] },
    whatsapp: { enabled: false, sessionPath: path.join(tmp, "wa"), recipients: [] },
    watcher: {
      directories: [watchDir],
      extensions: [".apk"],
      ignorePatterns: [],
      stabilityThresholdMs: 100,
    },
    naming: { pattern: "{appName}_v{version}_{buildType}_{date}_{time}" },
    limits: { maxFileSizeMB: 50, whatsappMaxMB: 2048 },
  });
  await config.setDefaultProfile("smoke");

  const history = new BuildHistory(10);
  const pipeline = new DeliveryPipeline(config, history);

  const outcome = await pipeline.process({
    filePath: apkPath,
    profile: "smoke",
  });

  const errors: string[] = [];

  if (!outcome.entry.metadata.versionName.startsWith("2.4.1")) {
    errors.push(`Expected parsed version 2.4.1, got ${outcome.entry.metadata.versionName}`);
  }
  if (outcome.entry.metadata.appName !== "seri_mediclinic") {
    errors.push(`Expected appName seri_mediclinic, got ${outcome.entry.metadata.appName}`);
  }
  if (outcome.entry.metadata.buildType !== "release") {
    errors.push(`Expected buildType release, got ${outcome.entry.metadata.buildType}`);
  }
  if (!outcome.stagedFilename.startsWith("seri_mediclinic_v2.4.1_release_")) {
    errors.push(`Unexpected staged filename: ${outcome.stagedFilename}`);
  }
  if (!(await fs.pathExists(apkPath))) {
    errors.push("ORIGINAL FILE WAS DELETED — zero-data-loss invariant broken!");
  }
  if ((await fs.stat(apkPath)).size !== originalSize) {
    errors.push("Original file was modified — zero-data-loss invariant broken!");
  }
  if (history.size() !== 1) {
    errors.push(`Expected 1 history entry, got ${history.size()}`);
  }
  const results = outcome.results;
  if (results.length === 0) {
    errors.push("Delivery router returned zero results — fan-out did not happen.");
  }
  const allFailed = results.every((r) => !r.success);
  if (!allFailed) {
    errors.push("Expected all deliveries to fail (bad token), some succeeded unexpectedly.");
  }
  // Staging cleanup: directory should be empty after run.
  const stagingFiles = (await fs.pathExists(stagingDir))
    ? await fs.readdir(stagingDir)
    : [];
  if (stagingFiles.length > 0) {
    errors.push(`Staging not cleaned up — still has: ${stagingFiles.join(", ")}`);
  }

  await pipeline.shutdown();
  await fs.remove(tmp);

  if (errors.length > 0) {
    console.error("SMOKE TEST FAILED:");
    for (const e of errors) console.error("  - " + e);
    process.exit(1);
  }

  console.log("SMOKE TEST PASSED");
  console.log(`  App: ${outcome.entry.metadata.appName}`);
  console.log(`  Version: ${outcome.entry.metadata.versionName}`);
  console.log(`  Build type: ${outcome.entry.metadata.buildType}`);
  console.log(`  Source: ${outcome.entry.metadata.source}`);
  console.log(`  Staged: ${outcome.stagedFilename}`);
  console.log(`  Pipeline total: ${outcome.totalMs}ms`);
  console.log(`  Delivery attempts: ${results.length} (all failed as expected — invalid token)`);
  console.log(`  Original preserved: yes, size=${originalSize}`);
  console.log(`  Staging cleaned: yes`);
  console.log(`  History entries: ${history.size()}`);
}

main().catch((err) => {
  console.error("SMOKE TEST CRASHED:", err);
  process.exit(1);
});
