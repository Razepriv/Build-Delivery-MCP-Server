import http, { type IncomingMessage, type Server, type ServerResponse } from "node:http";
import fs from "fs-extra";
import path from "node:path";
import type { TokenStore } from "./tokenStore.js";
import type { InstallEvent } from "../types.js";
import { logger } from "../utils/logger.js";
import { bytesToMB } from "../utils/fs.js";

export interface InstallServerOptions {
  readonly port: number;
  readonly host?: string;
  readonly store: TokenStore;
}

const TOKEN_PATH = /^\/install\/([0-9a-f]{48})(?:\/(info|download))?$/;

function getClientIp(req: IncomingMessage): string {
  // Honor X-Forwarded-For only when the operator has put a reverse proxy
  // in front; otherwise fall back to the socket address. We do not trust
  // the header by default — it can be spoofed.
  const trustForwarded = process.env.INTEL_TRACKING_TRUST_PROXY === "true";
  if (trustForwarded) {
    const xff = req.headers["x-forwarded-for"];
    if (typeof xff === "string") {
      const first = xff.split(",")[0];
      if (first) return first.trim();
    }
  }
  return req.socket.remoteAddress ?? "unknown";
}

function setSafeHeaders(res: ServerResponse): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
}

function send(res: ServerResponse, status: number, body: string, contentType = "text/plain"): void {
  setSafeHeaders(res);
  res.statusCode = status;
  res.setHeader("content-type", contentType);
  res.end(body);
}

export class InstallServer {
  private server?: Server;
  private readonly opts: InstallServerOptions;

  constructor(options: InstallServerOptions) {
    this.opts = options;
  }

  isRunning(): boolean {
    return Boolean(this.server?.listening);
  }

  async start(): Promise<{ host: string; port: number }> {
    if (this.server?.listening) {
      const addr = this.server.address();
      if (addr && typeof addr === "object") {
        return { host: addr.address, port: addr.port };
      }
    }

    await this.opts.store.init();

    const server = http.createServer((req, res) => {
      void this.handle(req, res).catch((err) => {
        logger.error(`Tracker handler crash: ${(err as Error).message}`);
        if (!res.headersSent) send(res, 500, "internal error");
      });
    });

    server.on("clientError", (err, socket) => {
      logger.debug(`Tracker clientError: ${(err as Error).message}`);
      socket.destroy();
    });

    const host = this.opts.host ?? "0.0.0.0";
    const port = this.opts.port;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => resolve());
    });

    this.server = server;
    logger.info(`Install tracking server listening on http://${host}:${port}`);
    return { host, port };
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    const srv = this.server;
    await new Promise<void>((resolve) => srv.close(() => resolve()));
    this.server = undefined;
    logger.info("Install tracking server stopped.");
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== "GET" && req.method !== "HEAD") {
      send(res, 405, "method not allowed");
      return;
    }

    const url = new URL(req.url ?? "/", "http://_local_");
    if (url.pathname === "/healthz") {
      send(res, 200, "ok");
      return;
    }

    const match = url.pathname.match(TOKEN_PATH);
    if (!match) {
      send(res, 404, "not found");
      return;
    }
    const [, candidate, action] = match;
    const record = this.opts.store.resolve(candidate!);
    if (!record) {
      send(res, 404, "expired or unknown token");
      return;
    }

    const exists = await fs.pathExists(record.filePath);
    if (!exists) {
      logger.warn(`Tracker: file gone for token ${candidate?.slice(0, 8)}…`);
      send(res, 410, "build no longer available");
      return;
    }

    const event: InstallEvent = {
      timestamp: Date.now(),
      token: candidate!,
      buildId: record.buildId,
      profile: record.profile,
      channel: record.channel,
      recipient: record.recipient,
      ip: getClientIp(req),
      userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
      kind: action === "info" ? "click" : "download",
    };
    this.opts.store.recordEvent(event);

    if (action === "info") {
      const stat = await fs.stat(record.filePath);
      const payload = {
        filename: record.filename,
        sizeMB: bytesToMB(stat.size),
        issuedAt: new Date(record.issuedAt).toISOString(),
        expiresAt: new Date(record.expiresAt).toISOString(),
      };
      send(res, 200, JSON.stringify(payload, null, 2), "application/json");
      return;
    }

    // Default + /download: stream the file.
    setSafeHeaders(res);
    res.statusCode = 200;
    res.setHeader("content-type", "application/octet-stream");
    res.setHeader(
      "content-disposition",
      `attachment; filename="${path.basename(record.filename)}"`,
    );
    const stream = fs.createReadStream(record.filePath);
    stream.on("error", () => {
      if (!res.headersSent) send(res, 500, "read error");
      else res.destroy();
    });
    stream.pipe(res);
  }
}
