import winston from "winston";
import path from "node:path";
import fs from "fs-extra";

const LOG_LEVEL = process.env.LOG_LEVEL ?? "info";
const LOG_DIR = process.env.LOG_DIR ?? "./logs";

fs.ensureDirSync(LOG_DIR);

const redact = winston.format((info) => {
  const scrub = (value: string): string => {
    if (typeof value !== "string") return value;
    return value.length > 14 ? `${value.slice(0, 10)}…[redacted]` : value;
  };

  const keys = ["botToken", "token", "sessionToken", "password", "apiKey"];
  for (const key of keys) {
    if (key in info && typeof info[key] === "string") {
      info[key] = scrub(info[key] as string);
    }
  }
  return info;
});

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: "HH:mm:ss" }),
  redact(),
  winston.format.printf(({ timestamp, level, message, ...rest }) => {
    const meta = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : "";
    return `${timestamp} ${level} ${message}${meta}`;
  }),
);

const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  redact(),
  winston.format.json(),
);

export const logger = winston.createLogger({
  level: LOG_LEVEL,
  transports: [
    // MCP servers speak over stdio, so send all logs to stderr to avoid
    // polluting the JSON-RPC stream on stdout.
    new winston.transports.Console({ format: consoleFormat, stderrLevels: ["error", "warn", "info", "debug", "verbose"] }),
    new winston.transports.File({
      filename: path.join(LOG_DIR, "error.log"),
      level: "error",
      format: fileFormat,
    }),
    new winston.transports.File({
      filename: path.join(LOG_DIR, "combined.log"),
      format: fileFormat,
    }),
  ],
});

export function truncateSecret(value: string | undefined): string {
  if (!value) return "<not-set>";
  if (value.length <= 10) return "<too-short>";
  return `${value.slice(0, 10)}…`;
}
