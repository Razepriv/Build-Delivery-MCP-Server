import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ConfigStore } from "./config/store.js";
import { BuildHistory } from "./history/buildHistory.js";
import { DeliveryPipeline } from "./pipeline.js";
import { BuildWatcher } from "./watcher/fileWatcher.js";
import { dispatchTool, toolDefinitions } from "./tools/index.js";
import { logger } from "./utils/logger.js";

export async function createServer(): Promise<{
  start: () => Promise<void>;
  stop: () => Promise<void>;
}> {
  const config = await ConfigStore.load();
  const history = new BuildHistory(100);
  const pipeline = new DeliveryPipeline(config, history);

  const { profile } = config.resolveProfile();
  const watcher = new BuildWatcher({
    directories: profile.watcher.directories,
    extensions: profile.watcher.extensions,
    ignorePatterns: profile.watcher.ignorePatterns,
    stabilityThresholdMs: profile.watcher.stabilityThresholdMs,
    onBuild: async (filePath) => {
      await pipeline.process({ filePath });
    },
  });

  const server = new Server(
    { name: "build-delivery-mcp", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolDefinitions,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    logger.debug(`Tool call: ${name}`);
    return dispatchTool(name, args ?? {}, {
      config,
      pipeline,
      history,
      watcher,
    });
  });

  const transport = new StdioServerTransport();

  return {
    async start() {
      await server.connect(transport);
      await watcher.start();
      logger.info("Build Delivery MCP server ready (stdio).");
    },
    async stop() {
      await watcher.stop();
      await pipeline.shutdown();
      await server.close();
      logger.info("Build Delivery MCP server stopped.");
    },
  };
}
