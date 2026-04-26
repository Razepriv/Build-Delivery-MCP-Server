import path from "node:path";
import nodemailer, { type Transporter } from "nodemailer";
import type {
  BuildMetadata,
  DeliveryResult,
  EmailConfig,
  RecipientTag,
} from "../types.js";
import {
  emailHtmlBody,
  emailSubject,
  emailTextBody,
} from "./captions.js";
import { filterByTags } from "./tags.js";
import { intelForRecipient } from "./intelHelper.js";
import type { DeliveryIntel } from "../intel/orchestrator.js";
import { logger } from "../utils/logger.js";
import { bytesToMB } from "../utils/fs.js";

/**
 * Most SMTP relays cap a single message at 25 MB after MIME encoding (which
 * adds ~33% overhead from base64). Defaulting to 25 keeps us safely under
 * Gmail/Workspace/Outlook limits without surprising users.
 */
const DEFAULT_MAX_MB = 25;

export class EmailService {
  private transporter?: Transporter;
  private readonly config: EmailConfig;
  private readonly maxMB: number;

  constructor(config: EmailConfig, maxMB = DEFAULT_MAX_MB) {
    this.config = config;
    this.maxMB = maxMB;
  }

  private getTransporter(): Transporter {
    if (!this.config.smtp) {
      throw new Error("Email SMTP is not configured.");
    }
    if (!this.transporter) {
      const { host, port, secure, user, pass } = this.config.smtp;
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: user && pass ? { user, pass } : undefined,
      });
    }
    return this.transporter;
  }

  isReady(): boolean {
    return Boolean(
      this.config.enabled &&
        this.config.smtp &&
        this.config.from &&
        this.config.recipients?.length,
    );
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    if (!this.config.smtp) return { ok: false, error: "SMTP not configured" };
    try {
      await this.getTransporter().verify();
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
    intel?: DeliveryIntel,
  ): Promise<DeliveryResult[]> {
    if (!this.isReady()) {
      throw new Error(
        "Email service is not ready (need smtp, from, recipients).",
      );
    }

    const targets = filterByTags(this.config.recipients ?? [], tags);
    if (targets.length === 0) return [];

    const sizeMB = bytesToMB(meta.fileSize);
    if (sizeMB > this.maxMB) {
      const msg = `File is ${sizeMB} MB; exceeds email cap of ${this.maxMB} MB.`;
      logger.warn(msg);
      return targets.map((r) => ({
        channel: "email",
        recipient: r.id,
        success: false,
        error: msg,
        durationMs: 0,
      }));
    }

    const subject = emailSubject(meta);
    const filename = path.basename(filePath);

    return Promise.all(
      targets.map(async (r) => {
        const start = Date.now();
        try {
          const recipientIntel = intelForRecipient(intel, "email", r.id);
          const text = emailTextBody(meta, customMessage, recipientIntel);
          const html = emailHtmlBody(meta, customMessage, recipientIntel);
          const info = await this.getTransporter().sendMail({
            from: this.config.from!,
            to: r.displayName ? `"${r.displayName}" <${r.id}>` : r.id,
            subject,
            text,
            html,
            attachments: [{ filename, path: filePath }],
          });
          return {
            channel: "email" as const,
            recipient: r.id,
            success: true,
            messageId: info.messageId,
            durationMs: Date.now() - start,
          };
        } catch (err) {
          return {
            channel: "email" as const,
            recipient: r.id,
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
      throw new Error("Email service is not ready.");
    }
    const targets = filterByTags(this.config.recipients ?? [], tags);
    return Promise.all(
      targets.map(async (r) => {
        const start = Date.now();
        try {
          const info = await this.getTransporter().sendMail({
            from: this.config.from!,
            to: r.displayName ? `"${r.displayName}" <${r.id}>` : r.id,
            subject: "[Build Delivery] Notification",
            text: message,
          });
          return {
            channel: "email" as const,
            recipient: r.id,
            success: true,
            messageId: info.messageId,
            durationMs: Date.now() - start,
          };
        } catch (err) {
          return {
            channel: "email" as const,
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
    if (this.transporter) {
      this.transporter.close();
      this.transporter = undefined;
    }
  }
}
