import chokidar, { type FSWatcher } from "chokidar";
import path from "node:path";
import { logger } from "../utils/logger.js";
import { waitForStableSize } from "../utils/fs.js";

export type BuildHandler = (filePath: string) => Promise<void>;

export interface WatcherOptions {
  readonly directories: readonly string[];
  readonly extensions: readonly string[];
  readonly ignorePatterns: readonly string[];
  readonly stabilityThresholdMs: number;
  readonly onBuild: BuildHandler;
}

export class BuildWatcher {
  private watcher?: FSWatcher;
  private readonly options: WatcherOptions;
  private readonly extSet: Set<string>;

  constructor(options: WatcherOptions) {
    this.options = options;
    this.extSet = new Set(options.extensions.map((e) => e.toLowerCase()));
  }

  private matchesExt(filePath: string): boolean {
    return this.extSet.has(path.extname(filePath).toLowerCase());
  }

  async start(): Promise<void> {
    if (this.watcher) return;

    this.watcher = chokidar.watch(this.options.directories as string[], {
      ignored: this.options.ignorePatterns as string[],
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: this.options.stabilityThresholdMs,
        pollInterval: 200,
      },
    });

    this.watcher.on("add", (filePath) => {
      if (!this.matchesExt(filePath)) return;
      void this.handleNewFile(filePath);
    });

    this.watcher.on("error", (err) => {
      logger.error(`Watcher error: ${(err as Error).message}`);
    });

    this.watcher.on("ready", () => {
      logger.info(
        `Watcher ready on: ${this.options.directories.join(", ")} (exts: ${this.options.extensions.join(", ")})`,
      );
    });
  }

  private async handleNewFile(filePath: string): Promise<void> {
    logger.info(`Detected new build: ${filePath}`);
    try {
      await waitForStableSize(filePath, this.options.stabilityThresholdMs);
      await this.options.onBuild(filePath);
    } catch (err) {
      logger.error(
        `Failed to process ${filePath}: ${(err as Error).message}`,
      );
    }
  }

  async stop(): Promise<void> {
    if (!this.watcher) return;
    await this.watcher.close();
    this.watcher = undefined;
    logger.info("Watcher stopped.");
  }

  async restart(options: Partial<Pick<WatcherOptions, "directories">>): Promise<void> {
    await this.stop();
    if (options.directories) {
      (this.options as { directories: readonly string[] }).directories = options.directories;
    }
    await this.start();
  }
}
