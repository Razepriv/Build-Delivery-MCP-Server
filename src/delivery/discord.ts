import path from "node:path";
import fs from "fs-extra";
import type {
  BuildMetadata,
  DeliveryResult,
  DiscordConfig,
  RecipientTag,
} from "../types.js";
import { discordCaption } from "./captions.js";
import { filterByTags } from "./tags.js";
import { logger } from "../utils/logger.js";
import { bytesToMB } from "../utils/fs.js";

/**
 * Discord webhook attachment cap on the free tier is 25 MB. Boosted
 * servers can go higher, but defaulting to 25 keeps webhook deliveries
 * predictable across all tiers.
 */
const DEFAULT_MAX_MB = 25;

export class DiscordService {
  private readonly config: DiscordConfig;
  private readonly maxMB: number;

  constructor(config: DiscordConfig, maxMB = DEFAULT_MAX_MB) {
    this.config = config;
    this.maxMB = maxMB;
  }

  isReady(): boolean {
    return Boolean(this.config.enabled && this.config.webhooks?.length);
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    if (!this.config.webhooks || this.config.webhooks.length === 0) {
      return { ok: false, error: "no webhooks configured" };
    }
    // GET on a webhook URL returns the webhook metadata when valid.
    const target = this.config.webhooks[0]!;
    try {
      const res = await fetch(target.id);
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async sendDocument(
    filePath: string,
    meta: BuildMetadata,
    customMessage?: string,
    tags?: readonly RecipientTag[],
  ): Promise<DeliveryResult[]> {
    if (!this.isReady()) {
      throw new Error("Discord service is not ready (no webhooks configured).");
    }

    const targets = filterByTags(this.config.webhooks ?? [], tags);
    const sizeMB = bytesToMB(meta.fileSize);

    if (sizeMB > this.maxMB) {
      const msg = `File is ${sizeMB} MB; exceeds Discord webhook cap of ${this.maxMB} MB.`;
      logger.warn(msg);
      return targets.map((t) => ({
        channel: "discord",
        recipient: redactWebhook(t.id),
        success: false,
        error: msg,
        durationMs: 0,
      }));
    }

    const content = discordCaption(meta, customMessage);
    const filename = path.basename(filePath);

    return Promise.all(
      targets.map(async (t) => {
        const start = Date.now();
        try {
          const fileBuffer = await fs.readFile(filePath);
          const form = new FormData();
          form.append(
            "payload_json",
            JSON.stringify({
              content,
              allowed_mentions: { parse: [] },
            }),
          );
          form.append(
            "files[0]",
            new Blob([new Uint8Array(fileBuffer)], { type: "application/octet-stream" }),
            filename,
          );
          const res = await fetch(`${t.id}?wait=true`, {
            method: "POST",
            body: form,
          });
          if (!res.ok) {
            const text = await res.text().catch(() => "");
            return {
              channel: "discord" as const,
              recipient: redactWebhook(t.id),
              success: false,
              error: `HTTP ${res.status}: ${text.slice(0, 200)}`,
              durationMs: Date.now() - start,
            };
          }
          const body = (await res.json().catch(() => ({}))) as { id?: string };
          return {
            channel: "discord" as const,
            recipient: redactWebhook(t.id),
            success: true,
            messageId: body.id,
            durationMs: Date.now() - start,
          };
        } catch (err) {
          return {
            channel: "discord" as const,
            recipient: redactWebhook(t.id),
            success: false,
            error: (err as Error).message,
            durationMs: Date.now() - start,
          };
        }
      }),
    );
  }

  async sendMessage(
    message: string,
    tags?: readonly RecipientTag[],
  ): Promise<DeliveryResult[]> {
    if (!this.isReady()) {
      throw new Error("Discord service is not ready.");
    }
    const targets = filterByTags(this.config.webhooks ?? [], tags);
    return Promise.all(
      targets.map(async (t) => {
        const start = Date.now();
        try {
          const res = await fetch(`${t.id}?wait=true`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              content: message,
              allowed_mentions: { parse: [] },
            }),
          });
          if (!res.ok) {
            const text = await res.text().catch(() => "");
            return {
              channel: "discord" as const,
              recipient: redactWebhook(t.id),
              success: false,
              error: `HTTP ${res.status}: ${text.slice(0, 200)}`,
              durationMs: Date.now() - start,
            };
          }
          const body = (await res.json().catch(() => ({}))) as { id?: string };
          return {
            channel: "discord" as const,
            recipient: redactWebhook(t.id),
            success: true,
            messageId: body.id,
            durationMs: Date.now() - start,
          };
        } catch (err) {
          return {
            channel: "discord" as const,
            recipient: redactWebhook(t.id),
            success: false,
            error: (err as Error).message,
            durationMs: Date.now() - start,
          };
        }
      }),
    );
  }

  async shutdown(): Promise<void> {
    // Stateless — nothing to release.
  }
}

/**
 * Discord webhook URLs contain the bot token in the path. Truncate to the
 * server-id segment so a redacted form stays useful in logs and tool output.
 */
export function redactWebhook(url: string): string {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    // /api/webhooks/<server-id>/<token>  → keep up to <server-id>
    const trimmed = parts.slice(0, 3).join("/");
    return `${parsed.origin}/${trimmed}/…`;
  } catch {
    return url.slice(0, 32) + "…";
  }
}
