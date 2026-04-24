# Build Delivery MCP Server

> **Drop a build. Get it renamed, captioned, and delivered to the right chat in under 5 seconds.**

Build Delivery MCP is a Model Context Protocol (MCP) server that automates the "last mile" of mobile CI/CD. It watches your build directory, extracts real metadata from the APK/AAB, renames the file using a configurable template, and delivers it through **Telegram** or **WhatsApp** — all without a human in the loop.

- **Dual-channel delivery:** Telegram (Bot API) + WhatsApp (QR-based, via `whatsapp-web.js`)
- **Multi-project profiles:** one installation, many clients, isolated credentials
- **Auto metadata:** app name, version, build type, SDK versions — pulled from `aapt`/`bundletool`
- **Zero data loss:** originals are never mutated; everything is copy-to-staging → deliver → cleanup
- **MCP-native:** works in Claude Desktop, Claude Code, Cursor; also runs as a standalone watcher

---

## Table of Contents

1. [Why this exists](#why-this-exists)
2. [Quick start](#quick-start)
3. [Configuration](#configuration)
4. [MCP tools](#mcp-tools)
5. [Filename templates](#filename-templates)
6. [Multi-project profiles](#multi-project-profiles)
7. [CI integration](#ci-integration)
8. [Using from Claude Desktop / Claude Code](#using-from-claude-desktop--claude-code)
9. [Troubleshooting](#troubleshooting)
10. [Architecture](#architecture)
11. [Security notes](#security-notes)
12. [Roadmap](#roadmap)
13. [License](#license)

---

## Why this exists

Every mobile team repeats the same loop after every build: Gradle spits out `app-release.apk` → someone renames it → drops it in Telegram/WhatsApp → "which version is this?" → repeat 10–50 times a week. Build Delivery MCP removes that loop. Total time target: **<5 seconds** per build.

---

## Quick start

### Prerequisites

- **Node.js 20+**
- **Android SDK** with `build-tools` installed (`ANDROID_HOME` set) for real APK metadata. The server falls back to filename heuristics if `aapt` is unavailable — so you can run without the SDK, you just get less metadata.
- **Java 17+** (optional, only needed for `.aab` metadata via `bundletool`)
- A **Telegram bot token** (via [@BotFather](https://t.me/BotFather)) and/or a spare phone for the WhatsApp QR scan

### Install

```bash
git clone https://github.com/Razepriv/Build-Delivery-MCP-Server.git
cd Build-Delivery-MCP-Server
npm install
npm run build
```

### Interactive setup

```bash
npm run setup
```

The wizard will ask you:

1. Profile name (one per client/project)
2. Default channel (Telegram or WhatsApp)
3. Telegram bot token + chat ID(s)
4. WhatsApp recipients (contacts end in `@c.us`, groups end in `@g.us`)
5. Watch directory
6. Filename template
7. File size limits
8. **Which CI platform you use** — it emits a ready-to-paste workflow for GitHub Actions, GitLab CI, Bitbucket Pipelines, or CircleCI (or none, for local-only)

Everything lands in `config.json`. You can edit that file directly or re-run the wizard to tweak things.

### Run

```bash
npm start
```

On the first run with WhatsApp enabled, a QR code appears in your terminal. On your phone: **WhatsApp → Linked Devices → Link a Device → scan**. The session is persisted under `./.wwebjs_auth/<profile>/` so subsequent runs skip the QR.

### Smoke test

Drop an APK or AAB into your watch directory. Within ~5 seconds you should see it rename + deliver. For a manual test:

```bash
# Using an MCP client, call the send_build tool:
# {
#   "filePath": "/absolute/path/to/app-release.apk",
#   "customMessage": "First test build — please confirm receipt."
# }
```

Or, if you're scripting it:

```ts
import { ConfigStore } from "build-delivery-mcp/dist/config/store.js";
import { DeliveryPipeline } from "build-delivery-mcp/dist/pipeline.js";
import { BuildHistory } from "build-delivery-mcp/dist/history/buildHistory.js";

const config = await ConfigStore.load();
const pipeline = new DeliveryPipeline(config, new BuildHistory());
await pipeline.process({ filePath: "/path/to/build.apk" });
await pipeline.shutdown();
```

---

## Configuration

Config lives in `config.json` (override with `CONFIG_PATH`). It supports multiple profiles so one installation can serve many clients.

```jsonc
{
  "defaultProfile": "default",
  "profiles": {
    "default": {
      "defaultChannel": "telegram",
      "telegram": {
        "enabled": true,
        "botToken": "123:abc…",
        "chatIds": ["-1001234567890"]
      },
      "whatsapp": {
        "enabled": true,
        "sessionPath": "./.wwebjs_auth/default",
        "recipients": [
          { "type": "contact", "id": "919876543210@c.us" },
          { "type": "group",   "id": "120363xxx@g.us" }
        ]
      },
      "watcher": {
        "directories": ["./builds", "./android/app/build/outputs/apk"],
        "extensions": [".apk", ".aab"],
        "ignorePatterns": ["**/intermediates/**", "**/temp/**"],
        "stabilityThresholdMs": 2000
      },
      "naming": {
        "pattern": "{appName}_v{version}_{buildType}_{date}_{time}"
      },
      "limits": {
        "maxFileSizeMB": 50,
        "whatsappMaxMB": 2048
      }
    }
  }
}
```

### Environment variable overrides

All settings have env-var equivalents for bootstrap and CI use:

| Variable | Purpose |
|---|---|
| `CONFIG_PATH` | Path to the config file (default `./config.json`) |
| `DEFAULT_PROFILE` | Profile used when none is specified |
| `DEFAULT_CHANNEL` | `telegram` or `whatsapp` |
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | Comma-separated chat IDs |
| `WHATSAPP_ENABLED` | `true`/`false` |
| `WHATSAPP_SESSION_PATH` | Session storage dir |
| `WHATSAPP_RECIPIENTS` | Comma-separated recipient IDs |
| `WATCH_DIRECTORY` | Comma-separated watch dirs |
| `WATCH_EXTENSIONS` | Comma-separated extensions (default `.apk,.aab`) |
| `NAMING_PATTERN` | Filename template |
| `MAX_FILE_SIZE_MB` | Telegram cap (default 50) |
| `WHATSAPP_MAX_MB` | WhatsApp cap (default 2048) |
| `ANDROID_HOME` | For `aapt` resolution |
| `BUNDLETOOL_PATH` | Absolute path to `bundletool.jar` |
| `LOG_LEVEL` | `debug`/`info`/`warn`/`error` |

---

## MCP tools

The server exposes nine tools over stdio. Every handler validates input with `zod` before touching the filesystem or network.

| Tool | Purpose |
|---|---|
| `configure_channel` | Set up Telegram or WhatsApp credentials on a profile. Triggers the QR flow for WhatsApp when no session exists. |
| `send_build` | Manually process a build file: parse → rename → deliver. Bypasses the watcher. |
| `process_apk` | Full-metadata auto flow (alias for `send_build`). Used by the watcher and CI. |
| `list_channels` | Report configured channels + readiness for a profile. |
| `test_channel` | Send a test ping to verify connectivity. |
| `get_build_history` | Return the last N delivered builds (up to 100) with per-recipient status. |
| `send_notification` | Send a freeform message through configured channels — great for "build failed" alerts. |
| `update_naming_pattern` | Hot-swap the filename template without a restart. |
| `set_watch_directory` | Add/change a watch directory and restart the watcher. |

Each tool returns a JSON content block. Errors surface as `isError: true` with a human-readable message.

---

## Filename templates

**Default:** `{appName}_v{version}_{buildType}_{date}_{time}`
**Example:** `webverse_arena_v2.4.1_release_2026-04-25_14-30-25.apk`

### Placeholders

| Placeholder | Source | Example |
|---|---|---|
| `{appName}` | `application-label` (sanitized) | `webverse_arena` |
| `{version}` | `versionName` | `2.4.1` |
| `{versionCode}` | `versionCode` | `241` |
| `{buildType}` | `debug` / `release` | `release` |
| `{package}` | `package` attribute | `com.webverse.arena` |
| `{date}` | `YYYY-MM-DD` | `2026-04-25` |
| `{time}` | `HH-MM-SS` | `14-30-25` |
| `{timestamp}` | Unix ms | `1745582425000` |
| `{year}`, `{month}`, `{day}` | Date parts | `2026`, `04`, `25` |
| `{hour}`, `{minute}`, `{second}` | Time parts | `14`, `30`, `25` |

Sanitization: `{appName}` is lowercased; non-alphanumeric runs collapse to `_`. Collisions in the staging directory are resolved with `_1`, `_2`, …

---

## Multi-project profiles

One installation can manage deliveries for many clients. Each profile has its own Telegram bot, WhatsApp session, watch directories, and template:

```jsonc
{
  "defaultProfile": "default",
  "profiles": {
    "default": { /* …agency defaults… */ },
    "seri_mediclinic": {
      "defaultChannel": "whatsapp",
      "whatsapp": {
        "enabled": true,
        "sessionPath": "./.wwebjs_auth/seri",
        "recipients": [{ "type": "group", "id": "120363xxx@g.us" }]
      },
      "naming": { "pattern": "seri_v{version}_{date}" }
    }
  }
}
```

Target a specific profile from any MCP tool:

```jsonc
{
  "name": "send_build",
  "arguments": {
    "filePath": "/builds/seri_mediclinic_release.apk",
    "profile": "seri_mediclinic"
  }
}
```

---

## CI integration

The setup wizard generates a ready-to-paste workflow for your CI of choice. Here are the shapes:

### GitHub Actions

```yaml
# .github/workflows/build-delivery.yml
name: Build & Deliver
on: { push: { branches: [main] }, workflow_dispatch: {} }
jobs:
  deliver:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with: { distribution: temurin, java-version: "17" }
      - uses: android-actions/setup-android@v3
      - run: ./gradlew assembleRelease
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - run: npm install -g build-delivery-mcp
      - env:
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          TELEGRAM_CHAT_ID: ${{ secrets.TELEGRAM_CHAT_ID }}
        run: |
          APK=$(find app/build/outputs/apk/release -name "*.apk" | head -1)
          build-delivery-mcp --send "$APK"
```

### GitLab CI, Bitbucket, CircleCI

Run `npm run setup` and choose the platform — it will write a snippet to the right path (`.gitlab-ci.snippet.yml`, `bitbucket-pipelines.snippet.yml`, or `.circleci/config.snippet.yml`).

> **Heads up on WhatsApp in CI:** the QR flow requires interactive first-run. For CI use, either (a) use Telegram only, or (b) scan the QR on your local dev box, commit nothing under `.wwebjs_auth/`, and re-scan on each runner — so CI is typically Telegram-only unless you're running on a long-lived runner with a persisted session volume.

---

## Using from Claude Desktop / Claude Code

Add this to your Claude client's MCP server config (`~/.claude/claude_desktop_config.json` or the Claude Code equivalent):

```jsonc
{
  "mcpServers": {
    "build-delivery": {
      "command": "node",
      "args": ["/absolute/path/to/Build-Delivery-MCP-Server/dist/index.js"],
      "env": {
        "CONFIG_PATH": "/absolute/path/to/config.json",
        "TELEGRAM_BOT_TOKEN": "…",
        "TELEGRAM_CHAT_ID": "…"
      }
    }
  }
}
```

Now in Claude Desktop you can say things like:

> *"Send the latest Seri Mediclinic release to the WhatsApp group and post 'build #241 is live' as the caption."*

Claude will invoke `send_build` (or `send_notification`) with the right arguments.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "aapt not found" warnings | `ANDROID_HOME` unset or SDK build-tools missing | Install Android SDK build-tools; set `ANDROID_HOME`. Server still works with filename heuristics. |
| WhatsApp QR loops forever | Puppeteer can't launch headless Chromium | Install system deps (`libnss3`, `libatk1.0-0`, etc.); try `puppeteer.headless=false` once to diagnose. |
| Telegram delivery hangs | Large file near the 50 MB bot cap | Raise `WHATSAPP_MAX_MB`, route through WhatsApp; Telegram bots cannot exceed 50 MB. |
| Watcher misses files | File was written into a subdir matching `ignorePatterns` | Edit `ignorePatterns` in the profile; `set_watch_directory` does not touch ignores. |
| Duplicate deliveries | Watcher re-fires on rename | Leave `stabilityThresholdMs` at ≥ 2000. Gradle sometimes writes, moves, rewrites. |
| "Unknown profile" error | Profile hasn't been created via wizard | Re-run `npm run setup`, or call `configure_channel` with the new profile name. |

### Logs

Structured JSON logs land in `./logs/combined.log`; errors-only in `./logs/error.log`. The console gets a pretty-printed version (to **stderr** — never stdout, which is the MCP JSON-RPC channel).

---

## Architecture

```
┌───────────────────────────────────────────────────────────────┐
│                    MCP CLIENT (Claude, Cursor)                │
└────────────────────────────┬──────────────────────────────────┘
                             │ stdio
┌────────────────────────────▼──────────────────────────────────┐
│                 BUILD DELIVERY MCP SERVER                     │
│                                                               │
│  ┌──────────────┐   ┌─────────────┐   ┌─────────────────┐    │
│  │ File Watcher │──▶│ APK Parser  │──▶│ File Renamer    │    │
│  │ (chokidar)   │   │ (aapt/aab)  │   │ (template)      │    │
│  └──────────────┘   └─────────────┘   └────────┬────────┘    │
│                                                │              │
│  ┌──────────────┐   ┌─────────────┐   ┌───────▼─────────┐    │
│  │ Config Store │   │ Build       │   │ Delivery Router │    │
│  │ (multi-prof) │   │ History     │◀──│ (parallel fan)  │    │
│  └──────────────┘   └─────────────┘   └───────┬─────────┘    │
│                                                │              │
│            ┌───────────────────────────────────┤              │
│            ▼                                   ▼              │
│  ┌──────────────────┐              ┌──────────────────┐      │
│  │ Telegram Service │              │ WhatsApp Service │      │
│  │  (Bot API)       │              │  (whatsapp-web   │      │
│  │                  │              │   .js + QR auth) │      │
│  └──────────────────┘              └──────────────────┘      │
└───────────────────────────────────────────────────────────────┘
```

Key properties:

- **Parallel dispatch:** channels run concurrently via `Promise.allSettled`; one failing channel never blocks the other.
- **Copy-to-staging:** originals are never mutated or deleted. Staging files are removed after successful delivery.
- **Write debounce:** chokidar's `awaitWriteFinish` + a size-stability poll prevent half-written APK sends.
- **Session persistence:** WhatsApp sessions live under `./.wwebjs_auth/<profile>/`. First login only.

---

## Security notes

- **Never commit** `config.json`, `.env`, or `.wwebjs_auth/` — they contain bot tokens and session credentials. All three are in `.gitignore` by default.
- Bot tokens are **truncated to 10 chars** in tool responses and logs. Full tokens only exist in your local config file.
- Every MCP tool input is validated with `zod` before any filesystem or network operation.
- `whatsapp-web.js` is **not officially supported by Meta**. For agency use on personal/business devices this is typically fine, but read Meta's ToS if you deploy at scale. A future version may add Meta Cloud API as an alternative.

---

## Roadmap

- **Phase 2:** Slack, Discord, email (SMTP), Microsoft Teams. iOS IPA parsing.
- **Phase 3:** Changelog generation from git tags. Crashlytics correlation. Tester install tracking.
- **Phase 4:** Cloud storage backing (S3/R2/GDrive) for builds >50MB. Public install links. Web dashboard. Multi-tenant SaaS.
- **Phase 5:** Enterprise — SSO, audit logs, RBAC, on-prem, SOC 2.

---

## License

MIT © Razeen Shaheed / Webverse Arena
