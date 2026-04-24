#!/usr/bin/env node
import "dotenv/config";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import path from "node:path";
import fs from "fs-extra";
import { ConfigStore } from "../config/store.js";
import { emitCIWorkflow, type CIPlatform } from "./ciSnippets.js";

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

async function main() {
  const rl = readline.createInterface({ input, output });

  output.write("\n─── Build Delivery MCP — Setup Wizard ───\n\n");

  try {
    const profileName = await ask(rl, "Profile name (use one per client/project)", "default");
    const defaultChannel = await askChoice(
      rl,
      "Default delivery channel",
      ["telegram", "whatsapp"] as const,
      "telegram",
    );

    const enableTelegram = await askYesNo(rl, "Configure Telegram?", defaultChannel === "telegram");
    const telegram = enableTelegram
      ? {
          enabled: true,
          botToken: await ask(rl, "  Telegram bot token (from @BotFather)", process.env.TELEGRAM_BOT_TOKEN ?? ""),
          chatIds: (await ask(rl, "  Telegram chat IDs (comma-separated)", process.env.TELEGRAM_CHAT_ID ?? ""))
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        }
      : { enabled: false };

    const enableWhatsApp = await askYesNo(rl, "Configure WhatsApp?", defaultChannel === "whatsapp");
    const whatsappRecipients: { type: "contact" | "group"; id: string }[] = [];
    if (enableWhatsApp) {
      const raw = await ask(
        rl,
        "  WhatsApp recipient IDs (comma-separated; contact=<num>@c.us, group=<id>@g.us)",
        process.env.WHATSAPP_RECIPIENTS ?? "",
      );
      for (const id of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
        whatsappRecipients.push({
          type: id.endsWith("@g.us") ? "group" : "contact",
          id,
        });
      }
    }
    const whatsapp = enableWhatsApp
      ? {
          enabled: true,
          sessionPath: `./.wwebjs_auth/${profileName}`,
          recipients: whatsappRecipients,
        }
      : {
          enabled: false,
          sessionPath: `./.wwebjs_auth/${profileName}`,
          recipients: [],
        };

    const watchDir = await ask(rl, "Watch directory for builds", "./builds");
    const pattern = await ask(
      rl,
      "Filename template",
      "{appName}_v{version}_{buildType}_{date}_{time}",
    );
    const maxFileSize = Number(await ask(rl, "Max Telegram file size (MB)", "50"));
    const whatsappMaxMB = Number(await ask(rl, "Max WhatsApp file size (MB)", "2048"));

    const configPath = path.resolve(process.env.CONFIG_PATH ?? "./config.json");
    const store = await ConfigStore.load(configPath);

    await store.upsertProfile(profileName, {
      defaultChannel,
      telegram,
      whatsapp,
      watcher: {
        directories: [watchDir],
        extensions: [".apk", ".aab"],
        ignorePatterns: ["**/intermediates/**", "**/temp/**", "**/.staging/**"],
        stabilityThresholdMs: 2000,
      },
      naming: { pattern },
      limits: { maxFileSizeMB: maxFileSize, whatsappMaxMB },
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
    if (enableWhatsApp) {
      output.write("  3. npm start (first run will print a WhatsApp QR — scan from Linked Devices)\n");
    } else {
      output.write("  3. npm start\n");
    }
    output.write("  4. Drop an APK into the watch directory to smoke-test.\n\n");
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  console.error(`Setup failed: ${(err as Error).message}`);
  process.exit(1);
});
