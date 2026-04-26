import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ConfigStore } from "../config/store.js";
import type { DeliveryPipeline } from "../pipeline.js";
import type { BuildHistory } from "../history/buildHistory.js";
import type { BuildWatcher } from "../watcher/fileWatcher.js";
import type { ChannelName } from "../types.js";
import { DeliveryRouter } from "../delivery/router.js";
import {
  ConfigureChannelSchema,
  SendBuildSchema,
  ProcessApkSchema,
  ListChannelsSchema,
  TestChannelSchema,
  GetBuildHistorySchema,
  SendNotificationSchema,
  UpdateNamingPatternSchema,
  SetWatchDirectorySchema,
} from "./schemas.js";
import { truncateSecret } from "../utils/logger.js";

function successResult(payload: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
}

function errorResult(message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}

function validationError(err: z.ZodError): CallToolResult {
  const msg = err.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  return errorResult(`Invalid input: ${msg}`);
}

export interface HandlerContext {
  readonly config: ConfigStore;
  readonly pipeline: DeliveryPipeline;
  readonly history: BuildHistory;
  readonly watcher: BuildWatcher;
}

export async function handleConfigureChannel(
  args: unknown,
  ctx: HandlerContext,
): Promise<CallToolResult> {
  const parsed = ConfigureChannelSchema.safeParse(args);
  if (!parsed.success) return validationError(parsed.error);
  const input = parsed.data;
  const profileName = input.profile ?? ctx.config.snapshot().defaultProfile;
  const existing = ctx.config.snapshot().profiles[profileName];

  const patch: Record<string, unknown> = {};
  switch (input.channel) {
    case "telegram":
      if (!input.telegram) return errorResult("Telegram config block required.");
      patch.telegram = {
        enabled: true,
        botToken: input.telegram.botToken,
        chatIds: input.telegram.chatIds,
        chatTags: input.telegram.chatTags,
      };
      break;
    case "whatsapp":
      if (!input.whatsapp) return errorResult("WhatsApp config block required.");
      patch.whatsapp = {
        enabled: true,
        sessionPath: input.whatsapp.sessionPath ?? `./.wwebjs_auth/${profileName}`,
        recipients: input.whatsapp.recipients,
      };
      break;
    case "slack":
      if (!input.slack) return errorResult("Slack config block required.");
      patch.slack = {
        enabled: true,
        botToken: input.slack.botToken,
        channels: input.slack.channels,
      };
      break;
    case "discord":
      if (!input.discord) return errorResult("Discord config block required.");
      patch.discord = {
        enabled: true,
        webhooks: input.discord.webhooks,
      };
      break;
    case "email":
      if (!input.email) return errorResult("Email config block required.");
      patch.email = {
        enabled: true,
        smtp: input.email.smtp,
        from: input.email.from,
        recipients: input.email.recipients,
      };
      break;
    case "teams":
      if (!input.teams) return errorResult("Teams config block required.");
      patch.teams = {
        enabled: true,
        webhooks: input.teams.webhooks,
      };
      break;
  }
  if (input.makeDefault) patch.defaultChannel = input.channel;

  await ctx.config.upsertProfile(profileName, patch);

  let whatsappBootstrap: { ok: boolean; error?: string; qrDataUrl?: string } | undefined;
  if (input.channel === "whatsapp") {
    const { profile } = ctx.config.resolveProfile(profileName);
    const router = new DeliveryRouter({ profile, profileName });
    try {
      whatsappBootstrap = await router.whatsappService.ensureClient();
    } finally {
      await router.shutdown();
    }
  }

  return successResult({
    ok: true,
    profile: profileName,
    channel: input.channel,
    defaultChannel: input.makeDefault ? input.channel : existing?.defaultChannel,
    whatsappBootstrap,
    hint:
      input.channel === "whatsapp" && !whatsappBootstrap?.ok
        ? "Scan the QR printed to stderr; session will persist after first login."
        : undefined,
  });
}

export async function handleSendBuild(
  args: unknown,
  ctx: HandlerContext,
): Promise<CallToolResult> {
  const parsed = SendBuildSchema.safeParse(args);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const outcome = await ctx.pipeline.process({
      filePath: parsed.data.filePath,
      profile: parsed.data.profile,
      appName: parsed.data.appName,
      version: parsed.data.version,
      channels: parsed.data.channels as ChannelName[] | undefined,
      tags: parsed.data.tags,
      customMessage: parsed.data.customMessage,
    });
    return successResult({
      ok: outcome.results.some((r) => r.success),
      totalMs: outcome.totalMs,
      stagedFilename: outcome.stagedFilename,
      metadata: outcome.entry.metadata,
      results: outcome.results,
    });
  } catch (err) {
    return errorResult((err as Error).message);
  }
}

export async function handleProcessApk(
  args: unknown,
  ctx: HandlerContext,
): Promise<CallToolResult> {
  const parsed = ProcessApkSchema.safeParse(args);
  if (!parsed.success) return validationError(parsed.error);
  return handleSendBuild(
    {
      filePath: parsed.data.filePath,
      profile: parsed.data.profile,
      tags: parsed.data.tags,
    },
    ctx,
  );
}

export async function handleListChannels(
  args: unknown,
  ctx: HandlerContext,
): Promise<CallToolResult> {
  const parsed = ListChannelsSchema.safeParse(args);
  if (!parsed.success) return validationError(parsed.error);
  const { name, profile } = ctx.config.resolveProfile(parsed.data.profile);
  return successResult({
    profile: name,
    defaultChannel: profile.defaultChannel,
    telegram: {
      enabled: profile.telegram.enabled,
      hasToken: Boolean(profile.telegram.botToken),
      tokenPreview: truncateSecret(profile.telegram.botToken),
      chatIds: profile.telegram.chatIds ?? [],
      chatTags: profile.telegram.chatTags ?? {},
    },
    whatsapp: {
      enabled: profile.whatsapp.enabled,
      sessionPath: profile.whatsapp.sessionPath,
      recipients: profile.whatsapp.recipients ?? [],
    },
    slack: {
      enabled: profile.slack.enabled,
      hasToken: Boolean(profile.slack.botToken),
      tokenPreview: truncateSecret(profile.slack.botToken),
      channels: profile.slack.channels ?? [],
    },
    discord: {
      enabled: profile.discord.enabled,
      webhooks: (profile.discord.webhooks ?? []).map((w) => ({
        id: redactWebhookForDisplay(w.id),
        tags: w.tags ?? [],
      })),
    },
    email: {
      enabled: profile.email.enabled,
      smtp: profile.email.smtp
        ? { ...profile.email.smtp, pass: truncateSecret(profile.email.smtp.pass) }
        : undefined,
      from: profile.email.from,
      recipients: profile.email.recipients ?? [],
    },
    teams: {
      enabled: profile.teams.enabled,
      webhooks: (profile.teams.webhooks ?? []).map((w) => ({
        id: redactWebhookForDisplay(w.id),
        tags: w.tags ?? [],
      })),
    },
  });
}

function redactWebhookForDisplay(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname.split("/").slice(0, 4).join("/")}/…`;
  } catch {
    return url.slice(0, 32) + "…";
  }
}

export async function handleTestChannel(
  args: unknown,
  ctx: HandlerContext,
): Promise<CallToolResult> {
  const parsed = TestChannelSchema.safeParse(args);
  if (!parsed.success) return validationError(parsed.error);
  const { name, profile } = ctx.config.resolveProfile(parsed.data.profile);
  const channel: ChannelName = parsed.data.channel ?? profile.defaultChannel;

  const router = new DeliveryRouter({ profile, profileName: name });
  try {
    let result;
    switch (channel) {
      case "telegram":
        result = await router.telegramService.testConnection();
        break;
      case "whatsapp":
        result = await router.whatsappService.testConnection();
        break;
      case "slack":
        result = await router.slackService.testConnection();
        break;
      case "discord":
        result = await router.discordService.testConnection();
        break;
      case "email":
        result = await router.emailService.testConnection();
        break;
      case "teams":
        result = await router.teamsService.testConnection();
        break;
    }
    return successResult({ profile: name, channel, ...result });
  } finally {
    await router.shutdown();
  }
}

export async function handleGetBuildHistory(
  args: unknown,
  ctx: HandlerContext,
): Promise<CallToolResult> {
  const parsed = GetBuildHistorySchema.safeParse(args);
  if (!parsed.success) return validationError(parsed.error);
  const limit = parsed.data.limit ?? 10;
  const entries = ctx.history.list(limit);
  return successResult({
    count: entries.length,
    total: ctx.history.size(),
    entries: entries.map((e) => ({
      id: e.id,
      timestamp: new Date(e.timestamp).toISOString(),
      profile: e.profile,
      originalPath: e.originalPath,
      renamedFilename: e.renamedFilename,
      appName: e.metadata.appName,
      version: e.metadata.versionName,
      buildType: e.metadata.buildType,
      successCount: e.results.filter((r) => r.success).length,
      totalRecipients: e.results.length,
      results: e.results,
    })),
  });
}

export async function handleSendNotification(
  args: unknown,
  ctx: HandlerContext,
): Promise<CallToolResult> {
  const parsed = SendNotificationSchema.safeParse(args);
  if (!parsed.success) return validationError(parsed.error);
  const { name, profile } = ctx.config.resolveProfile(parsed.data.profile);
  const router = new DeliveryRouter({ profile, profileName: name });
  try {
    const results = await router.sendNotification(parsed.data.message, {
      channels: parsed.data.channels as ChannelName[] | undefined,
      tags: parsed.data.tags,
    });
    return successResult({
      profile: name,
      ok: results.some((r) => r.success),
      results,
    });
  } finally {
    await router.shutdown();
  }
}

export async function handleUpdateNamingPattern(
  args: unknown,
  ctx: HandlerContext,
): Promise<CallToolResult> {
  const parsed = UpdateNamingPatternSchema.safeParse(args);
  if (!parsed.success) return validationError(parsed.error);
  await ctx.config.updateNamingPattern(parsed.data.pattern, parsed.data.profile);
  const { name, profile } = ctx.config.resolveProfile(parsed.data.profile);
  return successResult({
    profile: name,
    pattern: profile.naming.pattern,
  });
}

export async function handleSetWatchDirectory(
  args: unknown,
  ctx: HandlerContext,
): Promise<CallToolResult> {
  const parsed = SetWatchDirectorySchema.safeParse(args);
  if (!parsed.success) return validationError(parsed.error);
  await ctx.config.addWatchDirectory(parsed.data.directory, parsed.data.profile);
  const { name, profile } = ctx.config.resolveProfile(parsed.data.profile);
  await ctx.watcher.restart({ directories: profile.watcher.directories });
  return successResult({
    profile: name,
    watching: profile.watcher.directories,
  });
}
