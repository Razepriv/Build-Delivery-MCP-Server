import { z } from "zod";

export const ChannelSchema = z.enum([
  "telegram",
  "whatsapp",
  "slack",
  "discord",
  "email",
  "teams",
]);

const TagListSchema = z.array(z.string().min(1)).optional();
const TaggedRecipientInputSchema = z.object({
  id: z.string().min(1),
  tags: TagListSchema,
});

export const ConfigureChannelSchema = z.object({
  channel: ChannelSchema,
  profile: z.string().min(1).optional(),
  makeDefault: z.boolean().optional(),
  telegram: z
    .object({
      botToken: z.string().min(1),
      chatIds: z.array(z.string().min(1)).min(1),
      chatTags: z.record(z.string(), z.array(z.string().min(1))).optional(),
    })
    .optional(),
  whatsapp: z
    .object({
      sessionPath: z.string().optional(),
      recipients: z
        .array(
          z.object({
            type: z.enum(["contact", "group"]),
            id: z.string().min(1),
            tags: TagListSchema,
          }),
        )
        .min(1),
    })
    .optional(),
  slack: z
    .object({
      botToken: z.string().min(1),
      channels: z.array(TaggedRecipientInputSchema).min(1),
    })
    .optional(),
  discord: z
    .object({
      webhooks: z.array(TaggedRecipientInputSchema).min(1),
    })
    .optional(),
  email: z
    .object({
      smtp: z.object({
        host: z.string().min(1),
        port: z.number().int().positive(),
        secure: z.boolean(),
        user: z.string().optional(),
        pass: z.string().optional(),
      }),
      from: z.string().email(),
      recipients: z
        .array(
          z.object({
            id: z.string().email(),
            displayName: z.string().optional(),
            tags: TagListSchema,
          }),
        )
        .min(1),
    })
    .optional(),
  teams: z
    .object({
      webhooks: z.array(TaggedRecipientInputSchema).min(1),
    })
    .optional(),
});

export const SendBuildSchema = z.object({
  filePath: z.string().min(1),
  profile: z.string().optional(),
  appName: z.string().optional(),
  version: z.string().optional(),
  channels: z.array(ChannelSchema).optional(),
  tags: TagListSchema,
  customMessage: z.string().optional(),
});

export const ProcessApkSchema = z.object({
  filePath: z.string().min(1),
  profile: z.string().optional(),
  tags: TagListSchema,
});

export const ListChannelsSchema = z.object({
  profile: z.string().optional(),
});

export const TestChannelSchema = z.object({
  channel: ChannelSchema.optional(),
  profile: z.string().optional(),
});

export const GetBuildHistorySchema = z.object({
  limit: z.number().int().positive().max(100).optional(),
});

export const SendNotificationSchema = z.object({
  message: z.string().min(1),
  profile: z.string().optional(),
  channels: z.array(ChannelSchema).optional(),
  tags: TagListSchema,
});

export const UpdateNamingPatternSchema = z.object({
  pattern: z.string().min(1),
  profile: z.string().optional(),
});

export const SetWatchDirectorySchema = z.object({
  directory: z.string().min(1),
  profile: z.string().optional(),
});

// ─── Phase 3 — Distribution Intelligence ───────────────────────────

export const SetIntelSettingsSchema = z.object({
  profile: z.string().optional(),
  changelog: z
    .object({
      enabled: z.boolean().optional(),
      repoPath: z.string().optional(),
      maxCommits: z.number().int().positive().max(500).optional(),
      includeTypes: z.array(z.string().min(1)).optional(),
    })
    .optional(),
  crashlytics: z
    .object({
      enabled: z.boolean().optional(),
      source: z.enum(["file", "http"]).optional(),
      path: z.string().optional(),
      authHeader: z.string().optional(),
    })
    .optional(),
  tracking: z
    .object({
      enabled: z.boolean().optional(),
      baseUrl: z.string().url().optional(),
      port: z.number().int().positive().max(65535).optional(),
      perRecipient: z.boolean().optional(),
      tokenTtlHours: z.number().int().positive().optional(),
      eventLogPath: z.string().optional(),
    })
    .optional(),
});

export const StartInstallServerSchema = z.object({
  profile: z.string().optional(),
});

export const StopInstallServerSchema = z.object({});

export const GetInstallEventsSchema = z.object({
  limit: z.number().int().positive().max(500).optional(),
});

export const GenerateChangelogSchema = z.object({
  profile: z.string().optional(),
  fromRef: z.string().optional(),
  toRef: z.string().optional(),
  maxCommits: z.number().int().positive().max(500).optional(),
});
