import type { Tool } from "@modelcontextprotocol/sdk/types.js";

const CHANNEL_ENUM = [
  "telegram",
  "whatsapp",
  "slack",
  "discord",
  "email",
  "teams",
] as const;

const TaggedRecipientSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
  },
  required: ["id"],
} as const;

export const toolDefinitions: Tool[] = [
  {
    name: "configure_channel",
    description:
      "Configure Telegram, WhatsApp, Slack, Discord, Email (SMTP), or Microsoft Teams credentials on a profile. For WhatsApp, triggers QR scan on first use if no saved session exists. Set makeDefault=true to route unspecified deliveries to this channel.",
    inputSchema: {
      type: "object",
      properties: {
        channel: { type: "string", enum: CHANNEL_ENUM as unknown as string[] },
        profile: { type: "string", description: "Profile name (defaults to 'default')." },
        makeDefault: { type: "boolean" },
        telegram: {
          type: "object",
          properties: {
            botToken: { type: "string" },
            chatIds: { type: "array", items: { type: "string" } },
            chatTags: {
              type: "object",
              additionalProperties: { type: "array", items: { type: "string" } },
              description: "Per-chat-id tags. Keys are chat IDs.",
            },
          },
        },
        whatsapp: {
          type: "object",
          properties: {
            sessionPath: { type: "string" },
            recipients: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["contact", "group"] },
                  id: { type: "string" },
                  tags: { type: "array", items: { type: "string" } },
                },
                required: ["type", "id"],
              },
            },
          },
        },
        slack: {
          type: "object",
          properties: {
            botToken: { type: "string" },
            channels: { type: "array", items: TaggedRecipientSchema },
          },
        },
        discord: {
          type: "object",
          properties: {
            webhooks: { type: "array", items: TaggedRecipientSchema },
          },
        },
        email: {
          type: "object",
          properties: {
            smtp: {
              type: "object",
              properties: {
                host: { type: "string" },
                port: { type: "number" },
                secure: { type: "boolean" },
                user: { type: "string" },
                pass: { type: "string" },
              },
              required: ["host", "port", "secure"],
            },
            from: { type: "string" },
            recipients: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  displayName: { type: "string" },
                  tags: { type: "array", items: { type: "string" } },
                },
                required: ["id"],
              },
            },
          },
        },
        teams: {
          type: "object",
          properties: {
            webhooks: { type: "array", items: TaggedRecipientSchema },
          },
        },
      },
      required: ["channel"],
    },
  },
  {
    name: "send_build",
    description:
      "Manually process a build file: parse → rename → deliver. Use this to bypass the watcher, override metadata, or target specific channels and recipient tags.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: { type: "string" },
        profile: { type: "string" },
        appName: { type: "string" },
        version: { type: "string" },
        channels: {
          type: "array",
          items: { type: "string", enum: CHANNEL_ENUM as unknown as string[] },
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional tag filter. Only deliver to recipients carrying any of these tags.",
        },
        customMessage: { type: "string" },
      },
      required: ["filePath"],
    },
  },
  {
    name: "process_apk",
    description:
      "Full-metadata auto flow for an APK/AAB/IPA. Alias for send_build — used by the watcher and by CI pipelines.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: { type: "string" },
        profile: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["filePath"],
    },
  },
  {
    name: "list_channels",
    description: "Report configured channels and readiness for the given profile (or default).",
    inputSchema: {
      type: "object",
      properties: { profile: { type: "string" } },
    },
  },
  {
    name: "test_channel",
    description: "Send a test ping to verify connectivity for a channel.",
    inputSchema: {
      type: "object",
      properties: {
        channel: { type: "string", enum: CHANNEL_ENUM as unknown as string[] },
        profile: { type: "string" },
      },
    },
  },
  {
    name: "get_build_history",
    description: "Return the last N delivered builds with per-recipient delivery status.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", default: 10 },
      },
    },
  },
  {
    name: "send_notification",
    description:
      "Send a freeform text message through configured channels. Useful for build-failed alerts from CI. Supports tag filtering.",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string" },
        profile: { type: "string" },
        channels: {
          type: "array",
          items: { type: "string", enum: CHANNEL_ENUM as unknown as string[] },
        },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["message"],
    },
  },
  {
    name: "update_naming_pattern",
    description: "Hot-swap the filename template without restarting the server.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        profile: { type: "string" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "set_watch_directory",
    description: "Add a watch directory to a profile and restart the watcher with the new set.",
    inputSchema: {
      type: "object",
      properties: {
        directory: { type: "string" },
        profile: { type: "string" },
      },
      required: ["directory"],
    },
  },
];
