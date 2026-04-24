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
  if (input.channel === "telegram") {
    if (!input.telegram) return errorResult("Telegram config block required.");
    patch.telegram = {
      enabled: true,
      botToken: input.telegram.botToken,
      chatIds: input.telegram.chatIds,
    };
  } else {
    if (!input.whatsapp) return errorResult("WhatsApp config block required.");
    patch.whatsapp = {
      enabled: true,
      sessionPath: input.whatsapp.sessionPath ?? `./.wwebjs_auth/${profileName}`,
      recipients: input.whatsapp.recipients,
    };
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
    { filePath: parsed.data.filePath, profile: parsed.data.profile },
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
    },
    whatsapp: {
      enabled: profile.whatsapp.enabled,
      sessionPath: profile.whatsapp.sessionPath,
      recipients: profile.whatsapp.recipients ?? [],
    },
  });
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
    if (channel === "telegram") {
      const result = await router.telegramService.testConnection();
      return successResult({ profile: name, channel, ...result });
    }
    const result = await router.whatsappService.testConnection();
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
