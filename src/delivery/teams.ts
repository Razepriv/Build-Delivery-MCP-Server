import type {
  BuildMetadata,
  DeliveryResult,
  RecipientTag,
  TeamsConfig,
} from "../types.js";
import { teamsCard } from "./captions.js";
import { filterByTags } from "./tags.js";
import { logger } from "../utils/logger.js";

/**
 * Microsoft Teams incoming webhooks accept JSON Adaptive Cards but do **not**
 * support direct file attachments. The Teams service therefore delivers a
 * rich notification (app name, version, build type, size) and notes the
 * staged filename so engineers know where the artifact lives.
 *
 * If you need actual file delivery into Teams, route the file through one
 * of the file-capable channels (Telegram / Slack / Discord / Email) and let
 * Teams carry the announcement.
 */
export class TeamsService {
  private readonly config: TeamsConfig;

  constructor(config: TeamsConfig) {
    this.config = config;
  }

  isReady(): boolean {
    return Boolean(this.config.enabled && this.config.webhooks?.length);
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    if (!this.config.webhooks?.length) {
      return { ok: false, error: "no webhooks configured" };
    }
    // Teams webhooks don't expose a GET; a tiny ping POST is the canonical test.
    const target = this.config.webhooks[0]!;
    try {
      const res = await fetch(target.id, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "Build Delivery MCP — connectivity test" }),
      });
      if (!res.ok && res.status !== 200) {
        return { ok: false, error: `HTTP ${res.status}` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async sendDocument(
    _filePath: string,
    meta: BuildMetadata,
    customMessage?: string,
    tags?: readonly RecipientTag[],
  ): Promise<DeliveryResult[]> {
    if (!this.isReady()) {
      throw new Error("Teams service is not ready.");
    }
    logger.debug(
      "Teams delivers a notification only — no file attachment (webhook limitation).",
    );

    const targets = filterByTags(this.config.webhooks ?? [], tags);
    const card = teamsCard(meta, customMessage);

    return Promise.all(
      targets.map(async (t) => {
        const start = Date.now();
        try {
          const res = await fetch(t.id, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(card),
          });
          if (!res.ok) {
            const text = await res.text().catch(() => "");
            return {
              channel: "teams" as const,
              recipient: redactWebhook(t.id),
              success: false,
              error: `HTTP ${res.status}: ${text.slice(0, 200)}`,
              durationMs: Date.now() - start,
            };
          }
          return {
            channel: "teams" as const,
            recipient: redactWebhook(t.id),
            success: true,
            durationMs: Date.now() - start,
          };
        } catch (err) {
          return {
            channel: "teams" as const,
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
      throw new Error("Teams service is not ready.");
    }
    const targets = filterByTags(this.config.webhooks ?? [], tags);
    return Promise.all(
      targets.map(async (t) => {
        const start = Date.now();
        try {
          const res = await fetch(t.id, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text: message }),
          });
          if (!res.ok) {
            const text = await res.text().catch(() => "");
            return {
              channel: "teams" as const,
              recipient: redactWebhook(t.id),
              success: false,
              error: `HTTP ${res.status}: ${text.slice(0, 200)}`,
              durationMs: Date.now() - start,
            };
          }
          return {
            channel: "teams" as const,
            recipient: redactWebhook(t.id),
            success: true,
            durationMs: Date.now() - start,
          };
        } catch (err) {
          return {
            channel: "teams" as const,
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

export function redactWebhook(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname.split("/").slice(0, 3).join("/")}/…`;
  } catch {
    return url.slice(0, 32) + "…";
  }
}
