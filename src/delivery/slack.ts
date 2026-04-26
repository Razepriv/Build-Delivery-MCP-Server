import path from "node:path";
import fs from "fs-extra";
import { WebClient, type ErrorCode } from "@slack/web-api";
import type {
  BuildMetadata,
  DeliveryResult,
  RecipientTag,
  SlackConfig,
} from "../types.js";
import { slackCaption } from "./captions.js";
import { filterByTags } from "./tags.js";
import { intelForRecipient } from "./intelHelper.js";
import type { DeliveryIntel } from "../intel/orchestrator.js";
import { logger } from "../utils/logger.js";
import { bytesToMB } from "../utils/fs.js";

const DEFAULT_MAX_MB = 1024; // Slack's hard cap is 1 GB on most plans.

export class SlackService {
  private client?: WebClient;
  private readonly config: SlackConfig;
  private readonly maxMB: number;

  constructor(config: SlackConfig, maxMB = DEFAULT_MAX_MB) {
    this.config = config;
    this.maxMB = maxMB;
  }

  private webClient(): WebClient {
    if (!this.config.botToken) {
      throw new Error("Slack botToken is not configured.");
    }
    if (!this.client) {
      this.client = new WebClient(this.config.botToken, {
        retryConfig: { retries: 2 },
      });
    }
    return this.client;
  }

  isReady(): boolean {
    return Boolean(
      this.config.enabled && this.config.botToken && this.config.channels?.length,
    );
  }

  async testConnection(): Promise<{ ok: boolean; error?: string; me?: string }> {
    if (!this.config.botToken) return { ok: false, error: "botToken missing" };
    try {
      const auth = await this.webClient().auth.test();
      return { ok: true, me: `@${auth.user ?? "bot"} (team: ${auth.team ?? "?"})` };
    } catch (err) {
      return { ok: false, error: this.errorMessage(err) };
    }
  }

  async sendDocument(
    filePath: string,
    meta: BuildMetadata,
    customMessage?: string,
    tags?: readonly RecipientTag[],
    intel?: DeliveryIntel,
  ): Promise<DeliveryResult[]> {
    if (!this.isReady()) {
      throw new Error("Slack service is not ready (missing token or channels).");
    }

    const targets = filterByTags(this.config.channels ?? [], tags);
    if (targets.length === 0) {
      return [];
    }

    const sizeMB = bytesToMB(meta.fileSize);
    if (sizeMB > this.maxMB) {
      const msg = `File is ${sizeMB} MB; exceeds Slack cap of ${this.maxMB} MB.`;
      logger.warn(msg);
      return targets.map((t) => ({
        channel: "slack",
        recipient: t.id,
        success: false,
        error: msg,
        durationMs: 0,
      }));
    }

    const filename = path.basename(filePath);
    const fileBuffer = await fs.readFile(filePath);

    // When per-recipient install URLs are in play, each channel needs a
    // distinct comment, so we loop. Otherwise we use the more efficient
    // multi-channel batch upload.
    const perRecipient = Boolean(intel?.installUrlFor);
    if (perRecipient) {
      return Promise.all(
        targets.map(async (t) => {
          const start = Date.now();
          try {
            const comment = slackCaption(
              meta,
              customMessage,
              intelForRecipient(intel, "slack", t.id),
            );
            const response = await this.webClient().filesUploadV2({
              channel_id: t.id,
              file: fileBuffer,
              filename,
              title: `${meta.appName} v${meta.versionName}`,
              initial_comment: comment,
            });
            const fileId =
              Array.isArray(response.files) && response.files.length > 0
                ? (response.files[0] as { id?: string }).id
                : undefined;
            return {
              channel: "slack" as const,
              recipient: t.id,
              success: true,
              messageId: fileId,
              durationMs: Date.now() - start,
            };
          } catch (err) {
            return {
              channel: "slack" as const,
              recipient: t.id,
              success: false,
              error: this.errorMessage(err),
              durationMs: Date.now() - start,
            };
          }
        }),
      );
    }

    const comment = slackCaption(meta, customMessage, intelForRecipient(intel, "slack", targets[0]!.id));

    const start = Date.now();
    try {
      const response = await this.webClient().filesUploadV2({
        channel_id: targets.map((t) => t.id).join(","),
        file: fileBuffer,
        filename,
        title: `${meta.appName} v${meta.versionName}`,
        initial_comment: comment,
      });
      const fileId =
        Array.isArray(response.files) && response.files.length > 0
          ? (response.files[0] as { id?: string }).id
          : undefined;
      return targets.map((t) => ({
        channel: "slack",
        recipient: t.id,
        success: true,
        messageId: fileId,
        durationMs: Date.now() - start,
      }));
    } catch (err) {
      const message = this.errorMessage(err);
      return targets.map((t) => ({
        channel: "slack",
        recipient: t.id,
        success: false,
        error: message,
        durationMs: Date.now() - start,
      }));
    }
  }

  async sendMessage(
    message: string,
    tags?: readonly RecipientTag[],
  ): Promise<DeliveryResult[]> {
    if (!this.isReady()) {
      throw new Error("Slack service is not ready.");
    }
    const targets = filterByTags(this.config.channels ?? [], tags);
    return Promise.all(
      targets.map(async (t) => {
        const start = Date.now();
        try {
          const res = await this.webClient().chat.postMessage({
            channel: t.id,
            text: message,
            mrkdwn: true,
          });
          return {
            channel: "slack" as const,
            recipient: t.id,
            success: true,
            messageId: res.ts,
            durationMs: Date.now() - start,
          };
        } catch (err) {
          return {
            channel: "slack" as const,
            recipient: t.id,
            success: false,
            error: this.errorMessage(err),
            durationMs: Date.now() - start,
          };
        }
      }),
    );
  }

  private errorMessage(err: unknown): string {
    if (typeof err === "object" && err !== null && "data" in err) {
      const data = (err as { data?: { error?: string } }).data;
      if (data?.error) return `Slack API error: ${data.error}`;
    }
    if (typeof err === "object" && err !== null && "code" in err) {
      const code = (err as { code?: ErrorCode }).code;
      if (code) return `Slack ${code}`;
    }
    if (err instanceof Error) return err.message;
    return String(err);
  }

  async shutdown(): Promise<void> {
    this.client = undefined;
  }
}
