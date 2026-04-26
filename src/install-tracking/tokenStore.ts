import { randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";
import fs from "fs-extra";
import type {
  ChannelName,
  InstallEvent,
  TokenRecord,
} from "../types.js";
import { logger } from "../utils/logger.js";

const TOKEN_BYTES = 24; // 48-char hex

export interface IssueOptions {
  readonly filePath: string;
  readonly filename: string;
  readonly profile: string;
  readonly buildId: string;
  readonly channel?: ChannelName;
  readonly recipient?: string;
  readonly ttlHours: number;
}

/**
 * In-memory token map + JSON-lines event log.
 *
 * Tokens are 48-char hex strings and validated by constant-time compare.
 * The event log is append-only, one JSON object per line — easy to tail
 * and easy to import into any analytics system. Old tokens are evicted
 * lazily on access (no background timer).
 */
export class TokenStore {
  private readonly records = new Map<string, TokenRecord>();
  private readonly eventLogPath: string;
  private logQueue: Promise<void> = Promise.resolve();

  constructor(eventLogPath: string) {
    this.eventLogPath = path.resolve(eventLogPath);
  }

  async init(): Promise<void> {
    await fs.ensureDir(path.dirname(this.eventLogPath));
  }

  issue(options: IssueOptions): TokenRecord {
    const token = randomBytes(TOKEN_BYTES).toString("hex");
    const issuedAt = Date.now();
    const expiresAt = issuedAt + options.ttlHours * 60 * 60 * 1000;

    const record: TokenRecord = {
      token,
      filePath: options.filePath,
      filename: options.filename,
      profile: options.profile,
      channel: options.channel,
      recipient: options.recipient,
      buildId: options.buildId,
      issuedAt,
      expiresAt,
    };
    this.records.set(token, record);
    return record;
  }

  /**
   * Look up a token. Performs a constant-time compare against every known
   * token to avoid timing-based token enumeration. Returns null on miss
   * or expiry.
   */
  resolve(candidate: string): TokenRecord | null {
    if (!candidate || typeof candidate !== "string") return null;
    if (candidate.length !== TOKEN_BYTES * 2) return null;

    const candidateBuf = Buffer.from(candidate, "hex");
    if (candidateBuf.length !== TOKEN_BYTES) return null;

    for (const [token, record] of this.records) {
      const tokenBuf = Buffer.from(token, "hex");
      if (
        tokenBuf.length === candidateBuf.length &&
        timingSafeEqual(tokenBuf, candidateBuf)
      ) {
        if (Date.now() > record.expiresAt) {
          this.records.delete(token);
          return null;
        }
        return record;
      }
    }
    return null;
  }

  evictExpired(): number {
    const now = Date.now();
    let removed = 0;
    for (const [token, record] of this.records) {
      if (record.expiresAt < now) {
        this.records.delete(token);
        removed += 1;
      }
    }
    return removed;
  }

  size(): number {
    return this.records.size;
  }

  recordEvent(event: InstallEvent): void {
    // Serialize log writes through a promise chain so concurrent events
    // never interleave a partial line.
    this.logQueue = this.logQueue.then(async () => {
      try {
        await fs.appendFile(this.eventLogPath, JSON.stringify(event) + "\n", {
          encoding: "utf8",
        });
      } catch (err) {
        logger.error(
          `Failed to write install event: ${(err as Error).message}`,
        );
      }
    });
  }

  async readEvents(limit = 50): Promise<InstallEvent[]> {
    if (!(await fs.pathExists(this.eventLogPath))) return [];
    // Tail the last `limit` lines. The log is small in the typical case
    // (events trickle in), so reading the whole file is acceptable for v1.
    const raw = await fs.readFile(this.eventLogPath, "utf8");
    const lines = raw.split("\n").filter(Boolean).slice(-limit);
    const events: InstallEvent[] = [];
    for (const line of lines) {
      try {
        events.push(JSON.parse(line) as InstallEvent);
      } catch {
        // skip corrupt line
      }
    }
    return events.reverse();
  }
}
