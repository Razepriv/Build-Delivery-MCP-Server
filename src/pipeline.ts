import { randomUUID } from "node:crypto";
import path from "node:path";
import type {
  BuildHistoryEntry,
  ChannelName,
  DeliveryResult,
  ProfileConfig,
  SendBuildOptions,
} from "./types.js";
import { ConfigStore } from "./config/store.js";
import { parseBuildFile } from "./parser/index.js";
import { renameToStaging } from "./renamer/index.js";
import { DeliveryRouter } from "./delivery/router.js";
import { BuildHistory } from "./history/buildHistory.js";
import { IntelOrchestrator } from "./intel/orchestrator.js";
import type { TokenStore } from "./install-tracking/tokenStore.js";
import { logger } from "./utils/logger.js";
import { safeRemove, bytesToMB } from "./utils/fs.js";

export interface PipelineOutcome {
  readonly entry: BuildHistoryEntry;
  readonly results: readonly DeliveryResult[];
  readonly stagedFilename: string;
  readonly totalMs: number;
}

export class DeliveryPipeline {
  private readonly routers = new Map<string, DeliveryRouter>();
  private tokenStore: TokenStore | null = null;

  constructor(
    private readonly config: ConfigStore,
    private readonly history: BuildHistory,
  ) {}

  /** Inject the install-tracking TokenStore. Pass null to disable tracking. */
  setTokenStore(store: TokenStore | null): void {
    this.tokenStore = store;
  }

  private getRouter(profileName: string, profile: ProfileConfig): DeliveryRouter {
    const existing = this.routers.get(profileName);
    if (existing) return existing;
    const router = new DeliveryRouter({ profile, profileName });
    this.routers.set(profileName, router);
    return router;
  }

  async process(options: SendBuildOptions): Promise<PipelineOutcome> {
    const start = Date.now();
    const { name: profileName, profile } = this.config.resolveProfile(options.profile);
    const absolutePath = path.resolve(options.filePath);

    logger.info(`[${profileName}] Processing ${absolutePath}`);
    let meta = await parseBuildFile(absolutePath);
    if (options.appName) meta = { ...meta, appName: options.appName };
    if (options.version) meta = { ...meta, versionName: options.version };

    const sizeMB = bytesToMB(meta.fileSize);
    logger.info(
      `[${profileName}] ${meta.appName} v${meta.versionName} (${meta.buildType}) ${sizeMB} MB · source=${meta.source}`,
    );

    const { stagedPath, stagedFilename } = await renameToStaging(
      meta,
      profile.naming.pattern,
    );

    const buildId = randomUUID();
    const orchestrator = new IntelOrchestrator(profile, this.tokenStore, {
      buildId,
      profile: profileName,
      stagedPath,
      stagedFilename,
    });
    const buildIntel = await orchestrator.collectBuildLevel();

    const router = this.getRouter(profileName, profile);
    const targets: ChannelName[] | undefined = options.channels
      ? [...options.channels]
      : undefined;

    const results = await router.deliverBuild(stagedPath, meta, {
      channels: targets,
      tags: options.tags,
      customMessage: options.customMessage,
      intel: {
        changelog: buildIntel.changelog,
        crashStats: buildIntel.crashStats,
        defaultInstallUrl: buildIntel.defaultInstallUrl,
        installUrlFor: orchestrator.installUrlResolver(),
      },
    });

    await safeRemove(stagedPath);

    const entry: BuildHistoryEntry = {
      id: buildId,
      timestamp: Date.now(),
      profile: profileName,
      originalPath: absolutePath,
      renamedFilename: stagedFilename,
      metadata: meta,
      results,
    };
    this.history.append(entry);

    const totalMs = Date.now() - start;
    const successCount = results.filter((r) => r.success).length;
    logger.info(
      `[${profileName}] Delivered ${successCount}/${results.length} recipients in ${totalMs}ms`,
    );

    return { entry, results, stagedFilename, totalMs };
  }

  async shutdown(): Promise<void> {
    await Promise.allSettled(
      Array.from(this.routers.values()).map((r) => r.shutdown()),
    );
    this.routers.clear();
  }
}
