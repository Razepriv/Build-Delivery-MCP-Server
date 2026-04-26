import type {
  BuildMetadata,
  ChannelName,
  DeliveryResult,
  ProfileConfig,
  RecipientTag,
} from "../types.js";
import { TelegramService } from "./telegram.js";
import { WhatsAppService } from "./whatsapp.js";
import { SlackService } from "./slack.js";
import { DiscordService } from "./discord.js";
import { EmailService } from "./email.js";
import { TeamsService } from "./teams.js";
import type { DeliveryIntel } from "../intel/orchestrator.js";
import { logger } from "../utils/logger.js";

export interface DeliveryRouterOptions {
  readonly profile: ProfileConfig;
  readonly profileName: string;
}

export interface DeliveryOptions {
  readonly channels?: readonly ChannelName[];
  readonly customMessage?: string;
  readonly tags?: readonly RecipientTag[];
  readonly intel?: DeliveryIntel;
}

export class DeliveryRouter {
  private readonly telegram: TelegramService;
  private readonly whatsapp: WhatsAppService;
  private readonly slack: SlackService;
  private readonly discord: DiscordService;
  private readonly email: EmailService;
  private readonly teams: TeamsService;
  private readonly profile: ProfileConfig;

  constructor(options: DeliveryRouterOptions) {
    this.profile = options.profile;
    const limits = options.profile.limits;
    this.telegram = new TelegramService(options.profile.telegram);
    this.whatsapp = new WhatsAppService(
      options.profile.whatsapp,
      options.profileName,
      limits.whatsappMaxMB,
    );
    this.slack = new SlackService(options.profile.slack, limits.slackMaxMB);
    this.discord = new DiscordService(options.profile.discord, limits.discordMaxMB);
    this.email = new EmailService(options.profile.email, limits.emailMaxMB);
    this.teams = new TeamsService(options.profile.teams);
  }

  get telegramService(): TelegramService {
    return this.telegram;
  }

  get whatsappService(): WhatsAppService {
    return this.whatsapp;
  }

  get slackService(): SlackService {
    return this.slack;
  }

  get discordService(): DiscordService {
    return this.discord;
  }

  get emailService(): EmailService {
    return this.email;
  }

  get teamsService(): TeamsService {
    return this.teams;
  }

  private resolveTargets(requested?: readonly ChannelName[]): ChannelName[] {
    if (requested && requested.length > 0) return [...requested];
    const channels: ChannelName[] = [];
    if (this.profile.telegram.enabled) channels.push("telegram");
    if (this.profile.whatsapp.enabled) channels.push("whatsapp");
    if (this.profile.slack.enabled) channels.push("slack");
    if (this.profile.discord.enabled) channels.push("discord");
    if (this.profile.email.enabled) channels.push("email");
    if (this.profile.teams.enabled) channels.push("teams");
    if (channels.length === 0) channels.push(this.profile.defaultChannel);
    return channels;
  }

  async deliverBuild(
    stagedPath: string,
    meta: BuildMetadata,
    options: DeliveryOptions = {},
  ): Promise<DeliveryResult[]> {
    const targets = this.resolveTargets(options.channels);
    const tagSummary = options.tags?.length ? ` [tags: ${options.tags.join(",")}]` : "";
    logger.info(`Dispatching to channels: ${targets.join(", ")}${tagSummary}`);

    const intel = options.intel;
    const jobs = targets.map(async (channel) => {
      switch (channel) {
        case "telegram":
          return this.telegram.sendDocument(
            stagedPath,
            meta,
            options.customMessage,
            options.tags,
            intel,
          );
        case "whatsapp":
          return this.whatsapp.sendDocument(
            stagedPath,
            meta,
            options.customMessage,
            options.tags,
            intel,
          );
        case "slack":
          return this.slack.sendDocument(
            stagedPath,
            meta,
            options.customMessage,
            options.tags,
            intel,
          );
        case "discord":
          return this.discord.sendDocument(
            stagedPath,
            meta,
            options.customMessage,
            options.tags,
            intel,
          );
        case "email":
          return this.email.sendDocument(
            stagedPath,
            meta,
            options.customMessage,
            options.tags,
            intel,
          );
        case "teams":
          return this.teams.sendDocument(
            stagedPath,
            meta,
            options.customMessage,
            options.tags,
            intel,
          );
        default:
          return [] as DeliveryResult[];
      }
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
    options: { channels?: readonly ChannelName[]; tags?: readonly RecipientTag[] } = {},
  ): Promise<DeliveryResult[]> {
    const targets = this.resolveTargets(options.channels);
    const jobs = targets.map(async (channel) => {
      switch (channel) {
        case "telegram":
          return this.telegram.sendMessage(message, options.tags);
        case "whatsapp":
          return this.whatsapp.sendMessage(message, options.tags);
        case "slack":
          return this.slack.sendMessage(message, options.tags);
        case "discord":
          return this.discord.sendMessage(message, options.tags);
        case "email":
          return this.email.sendMessage(message, options.tags);
        case "teams":
          return this.teams.sendMessage(message, options.tags);
        default:
          return [];
      }
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
    await Promise.allSettled([
      this.telegram.shutdown(),
      this.whatsapp.shutdown(),
      this.slack.shutdown(),
      this.discord.shutdown(),
      this.email.shutdown(),
      this.teams.shutdown(),
    ]);
  }
}
