import type { BuildMetadata, ChannelName, DeliveryResult, ProfileConfig } from "../types.js";
import { TelegramService } from "./telegram.js";
import { WhatsAppService } from "./whatsapp.js";
import { logger } from "../utils/logger.js";

export interface DeliveryRouterOptions {
  readonly profile: ProfileConfig;
  readonly profileName: string;
}

export class DeliveryRouter {
  private readonly telegram: TelegramService;
  private readonly whatsapp: WhatsAppService;
  private readonly profile: ProfileConfig;

  constructor(options: DeliveryRouterOptions) {
    this.profile = options.profile;
    this.telegram = new TelegramService(options.profile.telegram);
    this.whatsapp = new WhatsAppService(
      options.profile.whatsapp,
      options.profileName,
      options.profile.limits.whatsappMaxMB,
    );
  }

  get telegramService(): TelegramService {
    return this.telegram;
  }

  get whatsappService(): WhatsAppService {
    return this.whatsapp;
  }

  private resolveTargets(requested?: readonly ChannelName[]): ChannelName[] {
    if (requested && requested.length > 0) return [...requested];
    const channels: ChannelName[] = [];
    if (this.profile.telegram.enabled) channels.push("telegram");
    if (this.profile.whatsapp.enabled) channels.push("whatsapp");
    if (channels.length === 0) channels.push(this.profile.defaultChannel);
    return channels;
  }

  async deliverBuild(
    stagedPath: string,
    meta: BuildMetadata,
    options: { channels?: readonly ChannelName[]; customMessage?: string } = {},
  ): Promise<DeliveryResult[]> {
    const targets = this.resolveTargets(options.channels);
    logger.info(`Dispatching to channels: ${targets.join(", ")}`);

    const jobs = targets.map(async (channel) => {
      if (channel === "telegram") {
        return this.telegram.sendDocument(stagedPath, meta, options.customMessage);
      }
      if (channel === "whatsapp") {
        return this.whatsapp.sendDocument(stagedPath, meta, options.customMessage);
      }
      return [] as DeliveryResult[];
    });

    const settled = await Promise.allSettled(jobs);
    const results: DeliveryResult[] = [];
    settled.forEach((outcome, idx) => {
      if (outcome.status === "fulfilled") {
        results.push(...outcome.value);
      } else {
        results.push({
          channel: targets[idx]!,
          recipient: "n/a",
          success: false,
          error: outcome.reason?.message ?? String(outcome.reason),
          durationMs: 0,
        });
      }
    });
    return results;
  }

  async sendNotification(
    message: string,
    options: { channels?: readonly ChannelName[] } = {},
  ): Promise<DeliveryResult[]> {
    const targets = this.resolveTargets(options.channels);
    const jobs = targets.map(async (channel) => {
      if (channel === "telegram") return this.telegram.sendMessage(message);
      if (channel === "whatsapp") return this.whatsapp.sendMessage(message);
      return [];
    });

    const settled = await Promise.allSettled(jobs);
    return settled.flatMap((outcome, idx) => {
      if (outcome.status === "fulfilled") return outcome.value;
      return [
        {
          channel: targets[idx]!,
          recipient: "n/a",
          success: false,
          error: outcome.reason?.message ?? String(outcome.reason),
          durationMs: 0,
        },
      ];
    });
  }

  async shutdown(): Promise<void> {
    await Promise.allSettled([this.telegram.shutdown(), this.whatsapp.shutdown()]);
  }
}
