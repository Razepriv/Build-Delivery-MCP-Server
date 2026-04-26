import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { HandlerContext } from "./handlers.js";
import { toolDefinitions } from "./definitions.js";
import {
  handleConfigureChannel,
  handleSendBuild,
  handleProcessApk,
  handleListChannels,
  handleTestChannel,
  handleGetBuildHistory,
  handleSendNotification,
  handleUpdateNamingPattern,
  handleSetWatchDirectory,
  handleSetIntelSettings,
  handleStartInstallServer,
  handleStopInstallServer,
  handleGetInstallEvents,
  handleGenerateChangelog,
} from "./handlers.js";

type ToolHandler = (args: unknown, ctx: HandlerContext) => Promise<CallToolResult>;

const registry: Record<string, ToolHandler> = {
  configure_channel: handleConfigureChannel,
  send_build: handleSendBuild,
  process_apk: handleProcessApk,
  list_channels: handleListChannels,
  test_channel: handleTestChannel,
  get_build_history: handleGetBuildHistory,
  send_notification: handleSendNotification,
  update_naming_pattern: handleUpdateNamingPattern,
  set_watch_directory: handleSetWatchDirectory,
  set_intel_settings: handleSetIntelSettings,
  start_install_server: handleStartInstallServer,
  stop_install_server: handleStopInstallServer,
  get_install_events: handleGetInstallEvents,
  generate_changelog: handleGenerateChangelog,
};

export async function dispatchTool(
  name: string,
  args: unknown,
  ctx: HandlerContext,
): Promise<CallToolResult> {
  const handler = registry[name];
  if (!handler) {
    return {
      isError: true,
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
    };
  }
  return handler(args, ctx);
}

export { toolDefinitions };
