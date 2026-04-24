#!/usr/bin/env node
import "dotenv/config";
import { createServer } from "./server.js";
import { logger } from "./utils/logger.js";

async function main() {
  const server = await createServer();
  await server.start();

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down…`);
    try {
      await server.stop();
    } finally {
      process.exit(0);
    }
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("uncaughtException", (err) => {
    logger.error(`Uncaught exception: ${err.message}`, { stack: err.stack });
  });
  process.on("unhandledRejection", (reason) => {
    logger.error(`Unhandled rejection: ${String(reason)}`);
  });
}

main().catch((err) => {
  logger.error(`Fatal startup error: ${(err as Error).message}`, { stack: (err as Error).stack });
  process.exit(1);
});
