import fs from "fs-extra";
import path from "node:path";
import {
  RootConfigSchema,
  ProfileConfigSchema,
  type ParsedRootConfig,
  type ParsedProfileConfig,
} from "./schema.js";
import type { ProfileConfig, RootConfig } from "../types.js";

const DEFAULT_CONFIG_PATH = process.env.CONFIG_PATH ?? "./config.json";

function envToList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

function envToRecipients(value: string | undefined) {
  const ids = envToList(value);
  if (!ids) return undefined;
  return ids.map((id) => ({
    type: id.endsWith("@g.us") ? ("group" as const) : ("contact" as const),
    id,
  }));
}

function bootstrapFromEnv(): ParsedRootConfig {
  const profileName = process.env.DEFAULT_PROFILE ?? "default";

  const telegramEnabled = Boolean(process.env.TELEGRAM_BOT_TOKEN);
  const whatsappEnabled = process.env.WHATSAPP_ENABLED !== "false";
  const slackEnabled = Boolean(process.env.SLACK_BOT_TOKEN);
  const discordEnabled = Boolean(process.env.DISCORD_WEBHOOK_URL);
  const emailEnabled = Boolean(process.env.SMTP_HOST);
  const teamsEnabled = Boolean(process.env.TEAMS_WEBHOOK_URL);

  const chatIds = envToList(process.env.TELEGRAM_CHAT_ID);
  const recipients = envToRecipients(process.env.WHATSAPP_RECIPIENTS);
  const watchDirs = envToList(process.env.WATCH_DIRECTORY);
  const exts = envToList(process.env.WATCH_EXTENSIONS);
  const slackChannels = envToList(process.env.SLACK_CHANNELS)?.map((id) => ({ id }));
  const discordWebhooks = envToList(process.env.DISCORD_WEBHOOK_URL)?.map((id) => ({ id }));
  const teamsWebhooks = envToList(process.env.TEAMS_WEBHOOK_URL)?.map((id) => ({ id }));
  const emailRecipients = envToList(process.env.EMAIL_RECIPIENTS)?.map((id) => ({ id }));

  return RootConfigSchema.parse({
    defaultProfile: profileName,
    profiles: {
      [profileName]: {
        defaultChannel:
          (process.env.DEFAULT_CHANNEL as
            | "telegram"
            | "whatsapp"
            | "slack"
            | "discord"
            | "email"
            | "teams"
            | undefined) ??
          (telegramEnabled
            ? "telegram"
            : whatsappEnabled
              ? "whatsapp"
              : slackEnabled
                ? "slack"
                : discordEnabled
                  ? "discord"
                  : emailEnabled
                    ? "email"
                    : teamsEnabled
                      ? "teams"
                      : "telegram"),
        telegram: {
          enabled: telegramEnabled,
          botToken: process.env.TELEGRAM_BOT_TOKEN,
          chatIds,
        },
        whatsapp: {
          enabled: whatsappEnabled,
          sessionPath:
            process.env.WHATSAPP_SESSION_PATH ?? `./.wwebjs_auth/${profileName}`,
          recipients,
        },
        slack: {
          enabled: slackEnabled,
          botToken: process.env.SLACK_BOT_TOKEN,
          channels: slackChannels,
        },
        discord: {
          enabled: discordEnabled,
          webhooks: discordWebhooks,
        },
        email: {
          enabled: emailEnabled,
          smtp: process.env.SMTP_HOST
            ? {
                host: process.env.SMTP_HOST,
                port: Number(process.env.SMTP_PORT ?? 587),
                secure: process.env.SMTP_SECURE === "true",
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
              }
            : undefined,
          from: process.env.EMAIL_FROM,
          recipients: emailRecipients,
        },
        teams: {
          enabled: teamsEnabled,
          webhooks: teamsWebhooks,
        },
        watcher: {
          directories: watchDirs ?? ["./builds"],
          extensions: exts ?? [".apk", ".aab", ".ipa"],
          stabilityThresholdMs: Number(process.env.WATCH_STABILITY_MS ?? 2000),
        },
        naming: {
          pattern:
            process.env.NAMING_PATTERN ??
            "{appName}_v{version}_{buildType}_{date}_{time}",
        },
        limits: {
          maxFileSizeMB: Number(process.env.MAX_FILE_SIZE_MB ?? 50),
          whatsappMaxMB: Number(process.env.WHATSAPP_MAX_MB ?? 2048),
          slackMaxMB: Number(process.env.SLACK_MAX_MB ?? 1024),
          discordMaxMB: Number(process.env.DISCORD_MAX_MB ?? 25),
          emailMaxMB: Number(process.env.EMAIL_MAX_MB ?? 25),
        },
      },
    },
  });
}

function toPublicProfile(p: ParsedProfileConfig): ProfileConfig {
  return {
    defaultChannel: p.defaultChannel,
    telegram: p.telegram,
    whatsapp: p.whatsapp,
    slack: p.slack,
    discord: p.discord,
    email: p.email,
    teams: p.teams,
    watcher: p.watcher,
    naming: p.naming,
    limits: p.limits,
  } as ProfileConfig;
}

function toPublicRoot(p: ParsedRootConfig): RootConfig {
  const profiles: Record<string, ProfileConfig> = {};
  for (const [name, prof] of Object.entries(p.profiles)) {
    profiles[name] = toPublicProfile(prof);
  }
  return { defaultProfile: p.defaultProfile, profiles };
}

export class ConfigStore {
  private config: ParsedRootConfig;
  private readonly filePath: string;

  private constructor(config: ParsedRootConfig, filePath: string) {
    this.config = config;
    this.filePath = filePath;
  }

  static async load(filePath: string = DEFAULT_CONFIG_PATH): Promise<ConfigStore> {
    const resolved = path.resolve(filePath);
    const exists = await fs.pathExists(resolved);

    if (exists) {
      const raw = await fs.readJson(resolved);
      const parsed = RootConfigSchema.parse(raw);
      return new ConfigStore(parsed, resolved);
    }

    const bootstrapped = bootstrapFromEnv();
    const store = new ConfigStore(bootstrapped, resolved);
    await store.save();
    return store;
  }

  async save(): Promise<void> {
    await fs.ensureDir(path.dirname(this.filePath));
    await fs.writeJson(this.filePath, this.config, { spaces: 2 });
  }

  snapshot(): RootConfig {
    return toPublicRoot(this.config);
  }

  getFilePath(): string {
    return this.filePath;
  }

  resolveProfile(profileName?: string): { name: string; profile: ProfileConfig } {
    const name = profileName ?? this.config.defaultProfile;
    const prof = this.config.profiles[name];
    if (!prof) {
      throw new Error(
        `Unknown profile "${name}". Known profiles: ${Object.keys(this.config.profiles).join(", ")}`,
      );
    }
    return { name, profile: toPublicProfile(prof) };
  }

  listProfiles(): string[] {
    return Object.keys(this.config.profiles);
  }

  async upsertProfile(name: string, patch: Partial<ParsedProfileConfig>): Promise<void> {
    const current = this.config.profiles[name];
    const merged = ProfileConfigSchema.parse({
      ...(current ?? {}),
      ...patch,
      telegram: { ...(current?.telegram ?? {}), ...(patch.telegram ?? {}) },
      whatsapp: { ...(current?.whatsapp ?? {}), ...(patch.whatsapp ?? {}) },
      slack: { ...(current?.slack ?? {}), ...(patch.slack ?? {}) },
      discord: { ...(current?.discord ?? {}), ...(patch.discord ?? {}) },
      email: { ...(current?.email ?? {}), ...(patch.email ?? {}) },
      teams: { ...(current?.teams ?? {}), ...(patch.teams ?? {}) },
      watcher: { ...(current?.watcher ?? {}), ...(patch.watcher ?? {}) },
      naming: { ...(current?.naming ?? {}), ...(patch.naming ?? {}) },
      limits: { ...(current?.limits ?? {}), ...(patch.limits ?? {}) },
    });

    this.config = {
      ...this.config,
      profiles: { ...this.config.profiles, [name]: merged },
    };
    await this.save();
  }

  async setDefaultProfile(name: string): Promise<void> {
    if (!this.config.profiles[name]) {
      throw new Error(`Cannot set default: profile "${name}" does not exist.`);
    }
    this.config = { ...this.config, defaultProfile: name };
    await this.save();
  }

  async updateNamingPattern(pattern: string, profileName?: string): Promise<void> {
    const name = profileName ?? this.config.defaultProfile;
    const current = this.config.profiles[name];
    if (!current) throw new Error(`Unknown profile "${name}".`);
    await this.upsertProfile(name, { naming: { pattern } });
  }

  async addWatchDirectory(directory: string, profileName?: string): Promise<void> {
    const name = profileName ?? this.config.defaultProfile;
    const current = this.config.profiles[name];
    if (!current) throw new Error(`Unknown profile "${name}".`);
    const dirs = Array.from(new Set([...current.watcher.directories, directory]));
    await this.upsertProfile(name, {
      watcher: { ...current.watcher, directories: dirs },
    });
  }
}
