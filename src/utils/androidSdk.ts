import path from "node:path";
import fs from "fs-extra";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "./logger.js";

const execFileAsync = promisify(execFile);
const IS_WINDOWS = process.platform === "win32";

function androidHome(): string | undefined {
  const envVars = ["ANDROID_HOME", "ANDROID_SDK_ROOT"];
  for (const key of envVars) {
    const value = process.env[key];
    if (value && fs.existsSync(value)) return value;
  }

  const candidates = IS_WINDOWS
    ? [
        path.join(os.homedir(), "AppData", "Local", "Android", "Sdk"),
        "C:/Android/Sdk",
      ]
    : [
        path.join(os.homedir(), "Library", "Android", "sdk"),
        path.join(os.homedir(), "Android", "Sdk"),
        "/usr/local/android-sdk",
        "/opt/android-sdk",
      ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

async function findInBuildTools(home: string, tool: string): Promise<string | undefined> {
  const buildToolsDir = path.join(home, "build-tools");
  if (!(await fs.pathExists(buildToolsDir))) return undefined;

  const exe = IS_WINDOWS ? `${tool}.exe` : tool;
  const versions = (await fs.readdir(buildToolsDir)).sort().reverse();

  for (const version of versions) {
    const full = path.join(buildToolsDir, version, exe);
    if (await fs.pathExists(full)) return full;
  }
  return undefined;
}

let aaptCache: string | null | undefined;
let aapt2Cache: string | null | undefined;
let bundletoolCache: string | null | undefined;

export async function resolveAapt(): Promise<string | null> {
  if (aaptCache !== undefined) return aaptCache;
  const home = androidHome();
  if (!home) {
    logger.warn("ANDROID_HOME not set — APK parsing will use filename fallback only.");
    aaptCache = null;
    return null;
  }
  const found = (await findInBuildTools(home, "aapt")) ?? null;
  if (found) logger.info(`Resolved aapt at ${found}`);
  aaptCache = found;
  return found;
}

export async function resolveAapt2(): Promise<string | null> {
  if (aapt2Cache !== undefined) return aapt2Cache;
  const home = androidHome();
  if (!home) {
    aapt2Cache = null;
    return null;
  }
  const found = (await findInBuildTools(home, "aapt2")) ?? null;
  if (found) logger.info(`Resolved aapt2 at ${found}`);
  aapt2Cache = found;
  return found;
}

export async function resolveBundletool(): Promise<string | null> {
  if (bundletoolCache !== undefined) return bundletoolCache;

  const envPath = process.env.BUNDLETOOL_PATH;
  if (envPath && (await fs.pathExists(envPath))) {
    bundletoolCache = envPath;
    return envPath;
  }

  // Look for bundletool-all.jar in ANDROID_HOME or common paths.
  const home = androidHome();
  const candidates: string[] = [];
  if (home) candidates.push(path.join(home, "bundletool.jar"), path.join(home, "bundletool-all.jar"));
  candidates.push("/usr/local/bin/bundletool.jar", "/opt/bundletool/bundletool-all.jar");

  for (const candidate of candidates) {
    if (await fs.pathExists(candidate)) {
      bundletoolCache = candidate;
      logger.info(`Resolved bundletool at ${candidate}`);
      return candidate;
    }
  }

  bundletoolCache = null;
  return null;
}

export async function runTool(binary: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync(binary, args as string[], {
    maxBuffer: 64 * 1024 * 1024,
    timeout: 30_000,
  });
  return stdout;
}
