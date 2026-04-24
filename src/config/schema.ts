import { z } from "zod";

export const WhatsAppRecipientSchema = z.object({
  type: z.enum(["contact", "group"]),
  id: z.string().min(1),
});

export const TelegramConfigSchema = z.object({
  enabled: z.boolean().default(false),
  botToken: z.string().optional(),
  chatIds: z.array(z.string()).optional(),
});

export const WhatsAppConfigSchema = z.object({
  enabled: z.boolean().default(false),
  sessionPath: z.string().default("./.wwebjs_auth/default"),
  recipients: z.array(WhatsAppRecipientSchema).optional(),
});

export const WatcherConfigSchema = z.object({
  directories: z.array(z.string()).default(["./builds"]),
  extensions: z.array(z.string()).default([".apk", ".aab"]),
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
});

export const ProfileConfigSchema = z.object({
  defaultChannel: z.enum(["telegram", "whatsapp"]).default("telegram"),
  telegram: TelegramConfigSchema.default({ enabled: false }),
  whatsapp: WhatsAppConfigSchema.default({ enabled: false }),
  watcher: WatcherConfigSchema.default({}),
  naming: NamingConfigSchema.default({}),
  limits: LimitsConfigSchema.default({}),
});

export const RootConfigSchema = z.object({
  defaultProfile: z.string().default("default"),
  profiles: z
    .record(z.string(), ProfileConfigSchema)
    .default({ default: ProfileConfigSchema.parse({}) }),
});

export type ParsedRootConfig = z.infer<typeof RootConfigSchema>;
export type ParsedProfileConfig = z.infer<typeof ProfileConfigSchema>;
