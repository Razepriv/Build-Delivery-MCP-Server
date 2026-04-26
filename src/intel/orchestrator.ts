import type {
  Changelog,
  ChannelName,
  CrashStats,
  IntelConfig,
  ProfileConfig,
  TokenRecord,
} from "../types.js";
import { generateChangelog } from "./changelog.js";
import { readCrashStats } from "./crashlytics.js";
import { TokenStore } from "../install-tracking/tokenStore.js";
import { logger } from "../utils/logger.js";

export interface IntelContext {
  readonly buildId: string;
  readonly profile: string;
  readonly stagedPath: string;
  readonly stagedFilename: string;
}

export interface DeliveryIntel {
  readonly changelog?: Changelog | null;
  readonly crashStats?: CrashStats | null;
  /** Build-level (non-per-recipient) install URL when tracking is enabled. */
  readonly defaultInstallUrl?: string;
  /** Lazy resolver for per-recipient install URLs. */
  readonly installUrlFor?: (channel: ChannelName, recipientId: string) => string | undefined;
}

/**
 * Coordinates the three Phase 3 collectors (changelog, crashlytics,
 * install-tracking tokens) for a single build delivery. Holds nothing
 * persistent — one orchestrator per build, then GC'd.
 */
export class IntelOrchestrator {
  private readonly perRecipientTokens = new Map<string, TokenRecord>();
  private buildToken?: TokenRecord;

  constructor(
    private readonly profile: ProfileConfig,
    private readonly tokenStore: TokenStore | null,
    private readonly ctx: IntelContext,
  ) {}

  private get config(): IntelConfig {
    return this.profile.intel;
  }

  private trackingEnabled(): boolean {
    return Boolean(this.config.tracking.enabled && this.tokenStore);
  }

  private composeUrl(token: string): string {
    const base = (this.config.tracking.baseUrl ?? "http://localhost:7331").replace(/\/$/, "");
    return `${base}/install/${token}`;
  }

  async collectBuildLevel(): Promise<{
    changelog?: Changelog | null;
    crashStats?: CrashStats | null;
    defaultInstallUrl?: string;
  }> {
    const tasks: Array<Promise<unknown>> = [];

    let changelogResult: Changelog | null = null;
    let crashResult: CrashStats | null = null;

    if (this.config.changelog.enabled) {
      tasks.push(
        generateChangelog(this.config.changelog)
          .then((c) => {
            changelogResult = c;
          })
          .catch((err: unknown) => {
            logger.warn(`Changelog collection failed: ${(err as Error).message}`);
          }),
      );
    }
    if (this.config.crashlytics.enabled) {
      tasks.push(
        readCrashStats(this.config.crashlytics)
          .then((c) => {
            crashResult = c;
          })
          .catch((err: unknown) => {
            logger.warn(`Crashlytics collection failed: ${(err as Error).message}`);
          }),
      );
    }

    await Promise.allSettled(tasks);

    let defaultInstallUrl: string | undefined;
    if (this.trackingEnabled()) {
      this.buildToken = this.tokenStore!.issue({
        filePath: this.ctx.stagedPath,
        filename: this.ctx.stagedFilename,
        profile: this.ctx.profile,
        buildId: this.ctx.buildId,
        ttlHours: this.config.tracking.tokenTtlHours ?? 168,
      });
      defaultInstallUrl = this.composeUrl(this.buildToken.token);
    }

    return {
      changelog: changelogResult,
      crashStats: crashResult,
      defaultInstallUrl,
    };
  }

  /**
   * Returns a resolver suitable for passing to channel services. When
   * `perRecipient` is enabled, issues a fresh token per (channel, recipient)
   * pair on first lookup and reuses it on subsequent lookups for the
   * same key. When `perRecipient` is disabled, returns the build-level URL.
   */
  installUrlResolver(): DeliveryIntel["installUrlFor"] {
    if (!this.trackingEnabled()) return undefined;
    const perRecipient = Boolean(this.config.tracking.perRecipient);
    const buildUrl = this.buildToken ? this.composeUrl(this.buildToken.token) : undefined;
    if (!perRecipient) {
      return () => buildUrl;
    }
    const ttlHours = this.config.tracking.tokenTtlHours ?? 168;
    return (channel: ChannelName, recipientId: string): string | undefined => {
      const key = `${channel}::${recipientId}`;
      const cached = this.perRecipientTokens.get(key);
      if (cached) return this.composeUrl(cached.token);
      const record = this.tokenStore!.issue({
        filePath: this.ctx.stagedPath,
        filename: this.ctx.stagedFilename,
        profile: this.ctx.profile,
        buildId: this.ctx.buildId,
        channel,
        recipient: recipientId,
        ttlHours,
      });
      this.perRecipientTokens.set(key, record);
      return this.composeUrl(record.token);
    };
  }
}
