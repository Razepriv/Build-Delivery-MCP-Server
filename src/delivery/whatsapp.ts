import path from "node:path";
import fs from "fs-extra";
import qrcodeTerminal from "qrcode-terminal";
import pkg from "whatsapp-web.js";
import type {
  BuildMetadata,
  DeliveryResult,
  RecipientTag,
  WhatsAppConfig,
  WhatsAppRecipient,
} from "../types.js";
import { whatsappCaption } from "./captions.js";
import { filterByTags } from "./tags.js";
import { logger } from "../utils/logger.js";
import { bytesToMB } from "../utils/fs.js";

const { Client, LocalAuth, MessageMedia } = pkg;

type WAClient = InstanceType<typeof Client>;

export interface ReadyInfo {
  ok: boolean;
  qrDataUrl?: string;
  error?: string;
}

export class WhatsAppService {
  private client?: WAClient;
  private readyPromise?: Promise<ReadyInfo>;
  private readonly config: WhatsAppConfig;
  private readonly profileName: string;
  private readonly maxMB: number;

  constructor(config: WhatsAppConfig, profileName: string, maxMB = 2048) {
    this.config = config;
    this.profileName = profileName;
    this.maxMB = maxMB;
  }

  isReady(): boolean {
    return Boolean(this.config.enabled && this.config.recipients?.length);
  }

  async ensureClient(): Promise<ReadyInfo> {
    if (this.readyPromise) return this.readyPromise;

    const sessionPath = this.config.sessionPath ?? `./.wwebjs_auth/${this.profileName}`;
    await fs.ensureDir(sessionPath);

    this.client = new Client({
      authStrategy: new LocalAuth({
        clientId: this.profileName,
        dataPath: path.dirname(sessionPath),
      }),
      puppeteer: {
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      },
    });

    this.readyPromise = new Promise<ReadyInfo>((resolve) => {
      let qrDataUrl: string | undefined;

      this.client!.on("qr", (qr: string) => {
        logger.info("WhatsApp QR code received — scan in Linked Devices.");
        qrcodeTerminal.generate(qr, { small: true });
        qrDataUrl = `data:text/plain;base64,${Buffer.from(qr).toString("base64")}`;
      });

      this.client!.on("ready", () => {
        logger.info(`WhatsApp client ready for profile "${this.profileName}".`);
        resolve({ ok: true, qrDataUrl });
      });

      this.client!.on("auth_failure", (msg: string) => {
        logger.error(`WhatsApp auth failure: ${msg}`);
        resolve({ ok: false, error: msg });
      });

      this.client!.on("disconnected", (reason: string) => {
        logger.warn(`WhatsApp disconnected: ${reason}`);
      });

      this.client!.initialize().catch((err: Error) => {
        resolve({ ok: false, error: err.message });
      });
    });

    return this.readyPromise;
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      const info = await this.ensureClient();
      if (!info.ok) return { ok: false, error: info.error };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  private recipientList(tags?: readonly RecipientTag[]): WhatsAppRecipient[] {
    return filterByTags(this.config.recipients ?? [], tags);
  }

  async sendDocument(
    filePath: string,
    meta: BuildMetadata,
    customMessage?: string,
    tags?: readonly RecipientTag[],
  ): Promise<DeliveryResult[]> {
    const targets = this.recipientList(tags);

    const sizeMB = bytesToMB(meta.fileSize);
    if (sizeMB > this.maxMB) {
      const msg = `File is ${sizeMB} MB; exceeds WhatsApp cap of ${this.maxMB} MB.`;
      logger.warn(msg);
      return targets.map((r) => ({
        channel: "whatsapp" as const,
        recipient: r.id,
        success: false,
        error: msg,
        durationMs: 0,
      }));
    }

    await this.ensureClient();
    const caption = whatsappCaption(meta, customMessage);
    const media = MessageMedia.fromFilePath(filePath);

    const results = await Promise.all(
      targets.map(async (r) => {
        const start = Date.now();
        try {
          const sent = await this.client!.sendMessage(r.id, media, { caption, sendMediaAsDocument: true });
          return {
            channel: "whatsapp" as const,
            recipient: r.id,
            success: true,
            messageId: sent.id?._serialized,
            durationMs: Date.now() - start,
          };
        } catch (err) {
          return {
            channel: "whatsapp" as const,
            recipient: r.id,
            success: false,
            error: (err as Error).message,
            durationMs: Date.now() - start,
          };
        }
      }),
    );
    return results;
  }

  async sendMessage(
    message: string,
    tags?: readonly RecipientTag[],
  ): Promise<DeliveryResult[]> {
    await this.ensureClient();
    return Promise.all(
      this.recipientList(tags).map(async (r) => {
        const start = Date.now();
        try {
          const sent = await this.client!.sendMessage(r.id, message);
          return {
            channel: "whatsapp" as const,
            recipient: r.id,
            success: true,
            messageId: sent.id?._serialized,
            durationMs: Date.now() - start,
          };
        } catch (err) {
          return {
            channel: "whatsapp" as const,
            recipient: r.id,
            success: false,
            error: (err as Error).message,
            durationMs: Date.now() - start,
          };
        }
      }),
    );
  }

  async shutdown(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.destroy();
    } catch {
      // best-effort
    }
    this.client = undefined;
    this.readyPromise = undefined;
  }
}
