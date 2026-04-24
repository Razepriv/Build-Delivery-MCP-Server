import { Telegraf } from "telegraf";
import fs from "fs-extra";
import type { BuildMetadata, DeliveryResult, TelegramConfig } from "../types.js";
import { telegramCaption } from "./captions.js";
import { logger } from "../utils/logger.js";
import { bytesToMB } from "../utils/fs.js";

const TELEGRAM_BOT_MAX_MB = 50;
const DOCUMENT_TIMEOUT_MS = 120_000;

export class TelegramService {
  private bot?: Telegraf;
  private readonly config: TelegramConfig;

  constructor(config: TelegramConfig) {
    this.config = config;
  }

  private client(): Telegraf {
    if (!this.config.botToken) {
      throw new Error("Telegram botToken is not configured.");
    }
    if (!this.bot) {
      this.bot = new Telegraf(this.config.botToken, {
        handlerTimeout: DOCUMENT_TIMEOUT_MS,
      });
    }
    return this.bot;
  }

  isReady(): boolean {
    return Boolean(this.config.enabled && this.config.botToken && this.config.chatIds?.length);
  }

  async testConnection(): Promise<{ ok: boolean; error?: string; me?: string }> {
    if (!this.config.botToken) return { ok: false, error: "botToken missing" };
    try {
      const me = await this.client().telegram.getMe();
      return { ok: true, me: `@${me.username ?? me.first_name}` };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async sendDocument(
    filePath: string,
    meta: BuildMetadata,
    customMessage?: string,
  ): Promise<DeliveryResult[]> {
    if (!this.isReady()) {
      throw new Error("Telegram service is not ready (missing token or chat IDs).");
    }

    const sizeMB = bytesToMB(meta.fileSize);
    if (sizeMB > TELEGRAM_BOT_MAX_MB) {
      const msg = `File is ${sizeMB} MB; exceeds Telegram bot cap of ${TELEGRAM_BOT_MAX_MB} MB. Skipping Telegram delivery (WhatsApp route still active).`;
      logger.warn(msg);
      return (this.config.chatIds ?? []).map((chatId) => ({
        channel: "telegram" as const,
        recipient: chatId,
        success: false,
        error: msg,
        durationMs: 0,
      }));
    }

    const caption = telegramCaption(meta, customMessage);
    const results: DeliveryResult[] = [];

    for (const chatId of this.config.chatIds ?? []) {
      const start = Date.now();
      try {
        const buffer = await fs.readFile(filePath);
        const message = await this.client().telegram.sendDocument(
          chatId,
          { source: buffer, filename: meta.appName ? `${meta.appName}.apk` : "build.apk" },
          { caption, parse_mode: "HTML" },
        );
        results.push({
          channel: "telegram",
          recipient: chatId,
          success: true,
          messageId: String(message.message_id),
          durationMs: Date.now() - start,
        });
      } catch (err) {
        results.push({
          channel: "telegram",
          recipient: chatId,
          success: false,
          error: (err as Error).message,
          durationMs: Date.now() - start,
        });
      }
    }
    return results;
  }

  async sendMessage(message: string): Promise<DeliveryResult[]> {
    if (!this.isReady()) {
      throw new Error("Telegram service is not ready.");
    }
    const results: DeliveryResult[] = [];
    for (const chatId of this.config.chatIds ?? []) {
      const start = Date.now();
      try {
        const msg = await this.client().telegram.sendMessage(chatId, message, { parse_mode: "HTML" });
        results.push({
          channel: "telegram",
          recipient: chatId,
          success: true,
          messageId: String(msg.message_id),
          durationMs: Date.now() - start,
        });
      } catch (err) {
        results.push({
          channel: "telegram",
          recipient: chatId,
          success: false,
          error: (err as Error).message,
          durationMs: Date.now() - start,
        });
      }
    }
    return results;
  }

  async shutdown(): Promise<void> {
    // Telegraf has no persistent connection when used only as API client.
    this.bot = undefined;
  }
}
