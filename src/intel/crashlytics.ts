import fs from "fs-extra";
import path from "node:path";
import type { CrashStats, CrashlyticsConfig } from "../types.js";
import { logger } from "../utils/logger.js";

/**
 * Read crash statistics for the previous version of an app.
 *
 * Phase 3 v1 keeps the integration vendor-neutral: stats arrive either
 * from a local JSON file (operators export from BigQuery, Crashlytics
 * dashboard, or whatever their analytics stack produces) or from an HTTP
 * endpoint that returns the same shape. The shape is:
 *
 * ```jsonc
 * {
 *   "versionName": "2.4.0",
 *   "crashFreeRate": 0.987,
 *   "totalCrashes": 14,
 *   "affectedUsers": 9,
 *   "topIssues": [{ "title": "NPE in checkout flow", "count": 6 }]
 * }
 * ```
 *
 * Returns null on missing config / unreadable source / parse failure —
 * callers treat null as "skip stability section in caption".
 */
export async function readCrashStats(
  config: CrashlyticsConfig,
): Promise<CrashStats | null> {
  if (!config.enabled) return null;

  if (!config.source || !config.path) {
    logger.warn(
      "Crashlytics enabled but source/path not configured — skipping.",
    );
    return null;
  }

  try {
    const raw =
      config.source === "file"
        ? await readFromFile(config.path)
        : await readFromHttp(config.path, config.authHeader);
    if (!raw) return null;
    return shapeStats(raw, config.source);
  } catch (err) {
    logger.warn(
      `Crashlytics read (${config.source}) failed: ${(err as Error).message}`,
    );
    return null;
  }
}

async function readFromFile(filePath: string): Promise<unknown | null> {
  const resolved = path.resolve(filePath);
  if (!(await fs.pathExists(resolved))) {
    logger.warn(`Crashlytics file not found: ${resolved}`);
    return null;
  }
  return fs.readJson(resolved);
}

async function readFromHttp(
  url: string,
  authHeader?: string,
): Promise<unknown | null> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (authHeader) headers.authorization = authHeader;

  const res = await fetch(url, {
    method: "GET",
    headers,
    // Reasonable bound — the operator owns the endpoint.
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    logger.warn(`Crashlytics HTTP ${res.status} from ${url}`);
    return null;
  }
  return res.json();
}

function shapeStats(raw: unknown, source: "file" | "http"): CrashStats | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  const versionName = String(obj.versionName ?? obj.version ?? "");
  if (!versionName) return null;

  const crashFreeRate = numberOrUndefined(obj.crashFreeRate);
  const totalCrashes = numberOrUndefined(obj.totalCrashes);
  const affectedUsers = numberOrUndefined(obj.affectedUsers);

  let topIssues: { title: string; count: number }[] | undefined;
  if (Array.isArray(obj.topIssues)) {
    topIssues = obj.topIssues
      .filter((i): i is Record<string, unknown> => Boolean(i) && typeof i === "object")
      .map((i) => ({
        title: String(i.title ?? "untitled"),
        count: Number(i.count ?? 0),
      }))
      .filter((i) => Number.isFinite(i.count) && i.count >= 0);
  }

  return {
    versionName,
    crashFreeRate,
    totalCrashes,
    affectedUsers,
    topIssues,
    source,
    fetchedAt: Date.now(),
  };
}

function numberOrUndefined(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}
