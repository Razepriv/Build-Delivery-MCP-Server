import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export const toolDefinitions: Tool[] = [
  {
    name: "configure_channel",
    description:
      "Configure Telegram or WhatsApp credentials on a profile. For WhatsApp, triggers QR scan on first use if no saved session exists. Set makeDefault=true to route unspecified deliveries to this channel.",
    inputSchema: {
      type: "object",
      properties: {
        channel: { type: "string", enum: ["telegram", "whatsapp"] },
        profile: { type: "string", description: "Profile name (defaults to 'default')." },
        makeDefault: { type: "boolean" },
        telegram: {
          type: "object",
          properties: {
            botToken: { type: "string" },
            chatIds: { type: "array", items: { type: "string" } },
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
                },
                required: ["type", "id"],
              },
            },
          },
        },
      },
      required: ["channel"],
    },
  },
  {
    name: "send_build",
    description:
      "Manually process a build file: parse → rename → deliver. Use this to bypass the watcher, override metadata, or target specific channels.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: { type: "string" },
        profile: { type: "string" },
        appName: { type: "string" },
        version: { type: "string" },
        channels: {
          type: "array",
          items: { type: "string", enum: ["telegram", "whatsapp"] },
        },
        customMessage: { type: "string" },
      },
      required: ["filePath"],
    },
  },
  {
    name: "process_apk",
    description:
      "Full-metadata auto flow for an APK/AAB. Alias for send_build with no overrides — used by the watcher and by CI pipelines.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: { type: "string" },
        profile: { type: "string" },
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
        channel: { type: "string", enum: ["telegram", "whatsapp"] },
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
      "Send a freeform text message through configured channels. Useful for build-failed alerts from CI.",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string" },
        profile: { type: "string" },
        channels: {
          type: "array",
          items: { type: "string", enum: ["telegram", "whatsapp"] },
        },
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
