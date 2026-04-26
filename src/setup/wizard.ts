#!/usr/bin/env node
import "dotenv/config";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import path from "node:path";
import fs from "fs-extra";
import { ConfigStore } from "../config/store.js";
import { emitCIWorkflow, type CIPlatform } from "./ciSnippets.js";
import type { ChannelName } from "../types.js";

async function ask(rl: readline.Interface, prompt: string, fallback = ""): Promise<string> {
  const hint = fallback ? ` [${fallback}]` : "";
  const answer = (await rl.question(`${prompt}${hint}: `)).trim();
  return answer || fallback;
}

async function askYesNo(rl: readline.Interface, prompt: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? "Y/n" : "y/N";
  const answer = (await rl.question(`${prompt} [${hint}]: `)).trim().toLowerCase();
  if (!answer) return defaultYes;
  return answer.startsWith("y");
}

async function askChoice<T extends string>(
  rl: readline.Interface,
  prompt: string,
  choices: readonly T[],
  defaultChoice: T,
): Promise<T> {
  const list = choices.map((c, i) => `  ${i + 1}. ${c}${c === defaultChoice ? " (default)" : ""}`).join("\n");
  const answer = (await rl.question(`${prompt}\n${list}\n› `)).trim();
  if (!answer) return defaultChoice;
  const idx = Number(answer);
  if (Number.isFinite(idx) && idx >= 1 && idx <= choices.length) return choices[idx - 1]!;
  const match = choices.find((c) => c.toLowerCase() === answer.toLowerCase());
  return match ?? defaultChoice;
}

async function configureTelegram(rl: readline.Interface) {
  const enabled = await askYesNo(rl, "Configure Telegram?", false);
  if (!enabled) return { enabled: false } as const;
  const botToken = await ask(rl, "  Telegram bot token (from @BotFather)", process.env.TELEGRAM_BOT_TOKEN ?? "");
  const chatIds = (await ask(rl, "  Telegram chat IDs (comma-separated)", process.env.TELEGRAM_CHAT_ID ?? ""))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return { enabled: true, botToken, chatIds } as const;
}

async function configureWhatsApp(rl: readline.Interface, profileName: string) {
  const enabled = await askYesNo(rl, "Configure WhatsApp?", false);
  const recipients: { type: "contact" | "group"; id: string; tags?: string[] }[] = [];
  if (enabled) {
    const raw = await ask(
      rl,
      "  WhatsApp recipient IDs (comma-separated; contact=<num>@c.us, group=<id>@g.us)",
      process.env.WHATSAPP_RECIPIENTS ?? "",
    );
    for (const id of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
      recipients.push({
        type: id.endsWith("@g.us") ? "group" : "contact",
        id,
      });
    }
  }
  return enabled
    ? {
        enabled: true,
        sessionPath: `./.wwebjs_auth/${profileName}`,
        recipients,
      }
    : {
        enabled: false,
        sessionPath: `./.wwebjs_auth/${profileName}`,
        recipients: [],
      };
}

async function configureSlack(rl: readline.Interface) {
  const enabled = await askYesNo(rl, "Configure Slack?", false);
  if (!enabled) return { enabled: false } as const;
  const botToken = await ask(rl, "  Slack bot token (xoxb-…)", process.env.SLACK_BOT_TOKEN ?? "");
  const raw = await ask(rl, "  Slack channel IDs (comma-separated, e.g. C0123ABC,C9999XYZ)", "");
  const channels = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((id) => ({ id }));
  return { enabled: true, botToken, channels } as const;
}

async function configureDiscord(rl: readline.Interface) {
  const enabled = await askYesNo(rl, "Configure Discord webhooks?", false);
  if (!enabled) return { enabled: false } as const;
  const raw = await ask(
    rl,
    "  Discord webhook URLs (comma-separated)",
    process.env.DISCORD_WEBHOOK_URL ?? "",
  );
  const webhooks = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((id) => ({ id }));
  return { enabled: true, webhooks } as const;
}

async function configureEmail(rl: readline.Interface) {
  const enabled = await askYesNo(rl, "Configure Email (SMTP)?", false);
  if (!enabled) return { enabled: false } as const;
  const host = await ask(rl, "  SMTP host", process.env.SMTP_HOST ?? "smtp.gmail.com");
  const port = Number(await ask(rl, "  SMTP port", process.env.SMTP_PORT ?? "587"));
  const secure = (await ask(rl, "  SMTP secure (true=465/TLS, false=587/STARTTLS)", "false")) === "true";
  const user = await ask(rl, "  SMTP user", process.env.SMTP_USER ?? "");
  const pass = await ask(rl, "  SMTP password / app password", process.env.SMTP_PASS ?? "");
  const from = await ask(rl, "  From address", process.env.EMAIL_FROM ?? user);
  const raw = await ask(rl, "  Recipient emails (comma-separated)", process.env.EMAIL_RECIPIENTS ?? "");
  const recipients = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((id) => ({ id }));
  return {
    enabled: true,
    smtp: { host, port, secure, user, pass },
    from,
    recipients,
  } as const;
}

async function configureTeams(rl: readline.Interface) {
  const enabled = await askYesNo(rl, "Configure Microsoft Teams (notifications only)?", false);
  if (!enabled) return { enabled: false } as const;
  const raw = await ask(
    rl,
    "  Teams incoming-webhook URLs (comma-separated)",
    process.env.TEAMS_WEBHOOK_URL ?? "",
  );
  const webhooks = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((id) => ({ id }));
  return { enabled: true, webhooks } as const;
}

async function configureIntel(rl: readline.Interface) {
  output.write("\n─── Distribution Intelligence (optional) ───\n");

  const changelogEnabled = await askYesNo(
    rl,
    "Enable changelog generation from git tags?",
    false,
  );
  const changelog = changelogEnabled
    ? {
        enabled: true,
        repoPath: await ask(rl, "  Path to the git repo", process.cwd()),
      }
    : { enabled: false };

  const crashEnabled = await askYesNo(
    rl,
    "Enable Crashlytics correlation? (requires JSON file or HTTP endpoint)",
    false,
  );
  const crashlytics = crashEnabled
    ? await (async () => {
        const source = await askChoice(
          rl,
          "  Stats source",
          ["file", "http"] as const,
          "file",
        );
        const path = await ask(
          rl,
          source === "file"
            ? "  Path to crash-stats JSON"
            : "  Crash-stats HTTP endpoint URL",
          "",
        );
        const authHeader =
          source === "http"
            ? await ask(rl, "  Authorization header (optional)", "")
            : "";
        return {
          enabled: true,
          source,
          path,
          authHeader: authHeader || undefined,
        };
      })()
    : { enabled: false };

  const trackingEnabled = await askYesNo(
    rl,
    "Enable install tracking (local HTTP server with unique links)?",
    false,
  );
  const tracking = trackingEnabled
    ? {
        enabled: true,
        port: Number(await ask(rl, "  Tracking server port", "7331")),
        baseUrl: (await ask(rl, "  Public base URL", "http://localhost:7331")) || undefined,
        perRecipient: await askYesNo(
          rl,
          "  Issue one token per recipient (so you can see who installed)?",
          false,
        ),
        tokenTtlHours: Number(await ask(rl, "  Token TTL (hours)", "168")),
      }
    : { enabled: false };

  return { changelog, crashlytics, tracking };
}

async function main() {
  const rl = readline.createInterface({ input, output });

  output.write("\n─── Build Delivery MCP — Setup Wizard ───\n\n");

  try {
    const profileName = await ask(rl, "Profile name (use one per client/project)", "default");
    const defaultChannel = await askChoice<ChannelName>(
      rl,
      "Default delivery channel",
      ["telegram", "whatsapp", "slack", "discord", "email", "teams"] as const,
      "telegram",
    );

    const telegram = await configureTelegram(rl);
    const whatsapp = await configureWhatsApp(rl, profileName);
    const slack = await configureSlack(rl);
    const discord = await configureDiscord(rl);
    const email = await configureEmail(rl);
    const teams = await configureTeams(rl);
    const intel = await configureIntel(rl);

    const watchDir = await ask(rl, "Watch directory for builds", "./builds");
    const pattern = await ask(
      rl,
      "Filename template",
      "{appName}_v{version}_{buildType}_{date}_{time}",
    );
    const maxFileSize = Number(await ask(rl, "Max Telegram file size (MB)", "50"));
    const whatsappMaxMB = Number(await ask(rl, "Max WhatsApp file size (MB)", "2048"));
    const slackMaxMB = Number(await ask(rl, "Max Slack file size (MB)", "1024"));
    const discordMaxMB = Number(await ask(rl, "Max Discord file size (MB)", "25"));
    const emailMaxMB = Number(await ask(rl, "Max Email attachment size (MB)", "25"));

    const configPath = path.resolve(process.env.CONFIG_PATH ?? "./config.json");
    const store = await ConfigStore.load(configPath);

    await store.upsertProfile(profileName, {
      defaultChannel,
      telegram,
      whatsapp,
      slack,
      discord,
      email,
      teams,
      watcher: {
        directories: [watchDir],
        extensions: [".apk", ".aab", ".ipa"],
        ignorePatterns: ["**/intermediates/**", "**/temp/**", "**/.staging/**"],
        stabilityThresholdMs: 2000,
      },
      naming: { pattern },
      limits: {
        maxFileSizeMB: maxFileSize,
        whatsappMaxMB,
        slackMaxMB,
        discordMaxMB,
        emailMaxMB,
      },
      intel: intel as never,
    });

    if (await askYesNo(rl, `Set "${profileName}" as the default profile?`, true)) {
      await store.setDefaultProfile(profileName);
    }

    output.write(`\n✓ Config written to ${configPath}\n\n`);

    const wantsCI = await askYesNo(rl, "Generate a CI workflow snippet?", true);
    if (wantsCI) {
      const platform = await askChoice<CIPlatform>(
        rl,
        "Which CI platform do you use?",
        ["github-actions", "gitlab-ci", "bitbucket", "circleci", "local-only"] as const,
        "github-actions",
      );
      if (platform !== "local-only") {
        const outPath = path.resolve(
          platform === "github-actions"
            ? ".github/workflows/build-delivery.yml"
            : platform === "gitlab-ci"
              ? ".gitlab-ci.snippet.yml"
              : platform === "bitbucket"
                ? "bitbucket-pipelines.snippet.yml"
                : ".circleci/config.snippet.yml",
        );
        await fs.ensureDir(path.dirname(outPath));
        await fs.writeFile(outPath, emitCIWorkflow(platform, profileName));
        output.write(`✓ CI snippet written to ${outPath}\n`);
      } else {
        output.write("\nLocal-only mode — just run `npm start` or point your MCP client at dist/index.js\n");
      }
    }

    output.write("\nNext steps:\n");
    output.write("  1. npm install\n");
    output.write("  2. npm run build\n");
    if (whatsapp.enabled) {
      output.write("  3. npm start (first run will print a WhatsApp QR — scan from Linked Devices)\n");
    } else {
      output.write("  3. npm start\n");
    }
    output.write("  4. Drop an APK / AAB / IPA into the watch directory to smoke-test.\n\n");
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  console.error(`Setup failed: ${(err as Error).message}`);
  process.exit(1);
});
