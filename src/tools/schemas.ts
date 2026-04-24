import { z } from "zod";

export const ChannelSchema = z.enum(["telegram", "whatsapp"]);

export const ConfigureChannelSchema = z.object({
  channel: ChannelSchema,
  profile: z.string().min(1).optional(),
  makeDefault: z.boolean().optional(),
  telegram: z
    .object({
      botToken: z.string().min(1),
      chatIds: z.array(z.string().min(1)).min(1),
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
          }),
        )
        .min(1),
    })
    .optional(),
});

export const SendBuildSchema = z.object({
  filePath: z.string().min(1),
  profile: z.string().optional(),
  appName: z.string().optional(),
  version: z.string().optional(),
  channels: z.array(ChannelSchema).optional(),
  customMessage: z.string().optional(),
});

export const ProcessApkSchema = z.object({
  filePath: z.string().min(1),
  profile: z.string().optional(),
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
});

export const UpdateNamingPatternSchema = z.object({
  pattern: z.string().min(1),
  profile: z.string().optional(),
});

export const SetWatchDirectorySchema = z.object({
  directory: z.string().min(1),
  profile: z.string().optional(),
});
