import { z } from "zod";

const TagListSchema = z.array(z.string().min(1)).optional();

const TaggedRecipientSchema = z.object({
  id: z.string().min(1),
  tags: TagListSchema,
});

export const WhatsAppRecipientSchema = z.object({
  type: z.enum(["contact", "group"]),
  id: z.string().min(1),
  tags: TagListSchema,
});

export const TelegramConfigSchema = z.object({
  enabled: z.boolean().default(false),
  botToken: z.string().optional(),
  chatIds: z.array(z.string()).optional(),
  chatTags: z.record(z.string(), z.array(z.string().min(1))).optional(),
});

export const WhatsAppConfigSchema = z.object({
  enabled: z.boolean().default(false),
  sessionPath: z.string().default("./.wwebjs_auth/default"),
  recipients: z.array(WhatsAppRecipientSchema).optional(),
});

export const SlackConfigSchema = z.object({
  enabled: z.boolean().default(false),
  botToken: z.string().optional(),
  channels: z.array(TaggedRecipientSchema).optional(),
});

export const DiscordConfigSchema = z.object({
  enabled: z.boolean().default(false),
  webhooks: z.array(TaggedRecipientSchema).optional(),
});

export const EmailRecipientSchema = z.object({
  id: z.string().email(),
  displayName: z.string().optional(),
  tags: TagListSchema,
});

export const EmailConfigSchema = z.object({
  enabled: z.boolean().default(false),
  smtp: z
    .object({
      host: z.string().min(1),
      port: z.number().int().positive(),
      secure: z.boolean().default(false),
      user: z.string().optional(),
      pass: z.string().optional(),
    })
    .optional(),
  from: z.string().optional(),
  recipients: z.array(EmailRecipientSchema).optional(),
});

export const TeamsConfigSchema = z.object({
  enabled: z.boolean().default(false),
  webhooks: z.array(TaggedRecipientSchema).optional(),
});

export const WatcherConfigSchema = z.object({
  directories: z.array(z.string()).default(["./builds"]),
  extensions: z.array(z.string()).default([".apk", ".aab", ".ipa"]),
  ignorePatterns: z
    .array(z.string())
    .default(["**/intermediates/**", "**/temp/**", "**/.staging/**"]),
  stabilityThresholdMs: z.number().int().positive().default(2000),
});

export const NamingConfigSchema = z.object({
  pattern: z
    .string()
    .default("{appName}_v{version}_{buildType}_{date}_{time}"),
});

export const LimitsConfigSchema = z.object({
  maxFileSizeMB: z.number().int().positive().default(50),
  whatsappMaxMB: z.number().int().positive().default(2048),
  slackMaxMB: z.number().int().positive().default(1024),
  discordMaxMB: z.number().int().positive().default(25),
  emailMaxMB: z.number().int().positive().default(25),
});

// ─── Phase 3 — Distribution Intelligence ───────────────────────────

export const ChangelogConfigSchema = z.object({
  enabled: z.boolean().default(false),
  repoPath: z.string().optional(),
  maxCommits: z.number().int().positive().max(500).default(50),
  includeTypes: z
    .array(z.string().min(1))
    .default(["feat", "fix", "perf", "refactor"]),
});

export const CrashlyticsConfigSchema = z.object({
  enabled: z.boolean().default(false),
  source: z.enum(["file", "http"]).optional(),
  path: z.string().optional(),
  authHeader: z.string().optional(),
});

export const InstallTrackingConfigSchema = z.object({
  enabled: z.boolean().default(false),
  baseUrl: z.string().url().optional(),
  port: z.number().int().positive().max(65535).default(7331),
  perRecipient: z.boolean().default(false),
  tokenTtlHours: z.number().int().positive().default(168), // 7 days
  eventLogPath: z.string().default("./.tracking/events.jsonl"),
});

export const IntelConfigSchema = z.object({
  changelog: ChangelogConfigSchema.default({}),
  crashlytics: CrashlyticsConfigSchema.default({}),
  tracking: InstallTrackingConfigSchema.default({}),
});

const ChannelEnumSchema = z.enum([
  "telegram",
  "whatsapp",
  "slack",
  "discord",
  "email",
  "teams",
]);

export const ProfileConfigSchema = z.object({
  defaultChannel: ChannelEnumSchema.default("telegram"),
  telegram: TelegramConfigSchema.default({ enabled: false }),
  whatsapp: WhatsAppConfigSchema.default({ enabled: false }),
  slack: SlackConfigSchema.default({ enabled: false }),
  discord: DiscordConfigSchema.default({ enabled: false }),
  email: EmailConfigSchema.default({ enabled: false }),
  teams: TeamsConfigSchema.default({ enabled: false }),
  watcher: WatcherConfigSchema.default({}),
  naming: NamingConfigSchema.default({}),
  limits: LimitsConfigSchema.default({}),
  intel: IntelConfigSchema.default({}),
});

export const RootConfigSchema = z.object({
  defaultProfile: z.string().default("default"),
  profiles: z
    .record(z.string(), ProfileConfigSchema)
    .default({ default: ProfileConfigSchema.parse({}) }),
});

export type ParsedRootConfig = z.infer<typeof RootConfigSchema>;
export type ParsedProfileConfig = z.infer<typeof ProfileConfigSchema>;
