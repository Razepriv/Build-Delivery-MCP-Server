# Build Delivery MCP Server

> **Drop a build. Get it renamed, captioned, and delivered to the right chat in under 5 seconds.**

Build Delivery MCP is a Model Context Protocol (MCP) server that automates the "last mile" of mobile CI/CD. It watches your build directory, extracts real metadata from the APK/AAB/IPA, renames the file using a configurable template, and delivers it through **six channels** — all without a human in the loop.

- **Six delivery channels:** Telegram (Bot API), WhatsApp (QR-based, via `whatsapp-web.js`), Slack (Web API), Discord (webhooks), Email (SMTP), Microsoft Teams (webhook notifications)
- **Three build formats:** Android `.apk` (via `aapt2`/`aapt`), Android `.aab` (via `bundletool`), iOS `.ipa` (Info.plist parsing — XML & binary)
- **Recipient tagging:** label recipients (`qa-team`, `design-leads`, `ceo`) and scope deliveries with a `tags` filter — broadcast to everyone, or just the people who need this build
- **Distribution intelligence:** auto-generated changelog from git tags, previous-version stability stats (Crashlytics or any source), and install tracking with unique per-recipient links served from a local HTTP endpoint
- **Multi-project profiles:** one installation, many clients, isolated credentials
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
        "chatIds": ["-1001234567890"],
        "chatTags": { "-1001234567890": ["qa-team", "internal"] }
      },
      "whatsapp": {
        "enabled": true,
        "sessionPath": "./.wwebjs_auth/default",
        "recipients": [
          { "type": "contact", "id": "919876543210@c.us", "tags": ["dev-lead"] },
          { "type": "group",   "id": "120363xxx@g.us",   "tags": ["qa-team"] }
        ]
      },
      "slack": {
        "enabled": true,
        "botToken": "xoxb-…",
        "channels": [
          { "id": "C0123ABC", "tags": ["engineering"] },
          { "id": "C9999XYZ", "tags": ["releases"] }
        ]
      },
      "discord": {
        "enabled": true,
        "webhooks": [
          { "id": "https://discord.com/api/webhooks/…/…", "tags": ["qa-team"] }
        ]
      },
      "email": {
        "enabled": true,
        "smtp": {
          "host": "smtp.gmail.com",
          "port": 587,
          "secure": false,
          "user": "deploy-bot@yourorg.com",
          "pass": "<app-password>"
        },
        "from": "deploy-bot@yourorg.com",
        "recipients": [
          { "id": "ceo@yourclient.com", "displayName": "Maya", "tags": ["board"] },
          { "id": "qa@yourclient.com",  "tags": ["qa-team"] }
        ]
      },
      "teams": {
        "enabled": true,
        "webhooks": [
          { "id": "https://outlook.office.com/webhook/…", "tags": ["releases"] }
        ]
      },
      "watcher": {
        "directories": ["./builds", "./android/app/build/outputs/apk"],
        "extensions": [".apk", ".aab", ".ipa"],
        "ignorePatterns": ["**/intermediates/**", "**/temp/**"],
        "stabilityThresholdMs": 2000
      },
      "naming": {
        "pattern": "{appName}_v{version}_{buildType}_{date}_{time}"
      },
      "limits": {
        "maxFileSizeMB": 50,
        "whatsappMaxMB": 2048,
        "slackMaxMB": 1024,
        "discordMaxMB": 25,
        "emailMaxMB": 25
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
| `DEFAULT_CHANNEL` | `telegram` / `whatsapp` / `slack` / `discord` / `email` / `teams` |
| `TELEGRAM_BOT_TOKEN` · `TELEGRAM_CHAT_ID` | Telegram credentials |
| `WHATSAPP_ENABLED` · `WHATSAPP_SESSION_PATH` · `WHATSAPP_RECIPIENTS` | WhatsApp |
| `SLACK_BOT_TOKEN` · `SLACK_CHANNELS` | Slack |
| `DISCORD_WEBHOOK_URL` | Comma-separated Discord webhook URLs |
| `SMTP_HOST` · `SMTP_PORT` · `SMTP_SECURE` · `SMTP_USER` · `SMTP_PASS` · `EMAIL_FROM` · `EMAIL_RECIPIENTS` | Email (SMTP) |
| `TEAMS_WEBHOOK_URL` | Comma-separated Teams incoming-webhook URLs |
| `WATCH_DIRECTORY` · `WATCH_EXTENSIONS` | Watcher (default extensions: `.apk,.aab,.ipa`) |
| `NAMING_PATTERN` | Filename template |
| `MAX_FILE_SIZE_MB` · `WHATSAPP_MAX_MB` · `SLACK_MAX_MB` · `DISCORD_MAX_MB` · `EMAIL_MAX_MB` | Per-channel size caps |
| `ANDROID_HOME` · `BUNDLETOOL_PATH` | Android tool resolution |
| `LOG_LEVEL` | `debug`/`info`/`warn`/`error` |

---

## MCP tools

The server exposes 14 tools over stdio. Every handler validates input with `zod` before touching the filesystem or network.

| Tool | Purpose |
|---|---|
| `configure_channel` | Set up Telegram, WhatsApp, Slack, Discord, Email (SMTP), or Teams credentials on a profile. Triggers the QR flow for WhatsApp when no session exists. |
| `send_build` | Manually process a build file: parse → rename → deliver. Accepts `tags` to scope to a recipient subset. |
| `process_apk` | Full-metadata auto flow (alias for `send_build`). Handles APK / AAB / IPA. Used by the watcher and CI. |
| `list_channels` | Report configured channels + readiness for a profile (tokens redacted). |
| `test_channel` | Send a test ping to verify connectivity for any channel. |
| `get_build_history` | Return the last N delivered builds (up to 100) with per-recipient status. |
| `send_notification` | Send a freeform message through configured channels with optional tag filter — great for "build failed" alerts. |
| `update_naming_pattern` | Hot-swap the filename template without a restart. |
| `set_watch_directory` | Add/change a watch directory and restart the watcher. |
| **`set_intel_settings`** | Toggle changelog generation, Crashlytics correlation, and install tracking for a profile. Each is independently configurable. |
| **`generate_changelog`** | On-demand changelog between two git refs. Returns the structured payload — useful for previewing before flipping `enabled`. |
| **`start_install_server`** | Boot the local install-tracking HTTP server. Reads port + log path from the active profile. |
| **`stop_install_server`** | Tear down the install-tracking server. |
| **`get_install_events`** | Return the most recent install events (clicks + downloads). |

Each tool returns a JSON content block. Errors surface as `isError: true` with a human-readable message.

### Recipient tagging

Every channel supports per-recipient tags. Two examples:

```jsonc
// Email recipients tagged by audience
"recipients": [
  { "id": "ceo@client.com",  "displayName": "Maya", "tags": ["board"] },
  { "id": "qa@client.com",   "tags": ["qa-team"] }
]
```

```jsonc
// MCP tool call: only deliver to the QA group across all enabled channels
{
  "name": "send_build",
  "arguments": {
    "filePath": "/builds/app-release.apk",
    "tags": ["qa-team"]
  }
}
```

Filter semantics are **OR** across the requested tags — a recipient matches if it carries *any* of the listed tags. Untagged recipients are excluded once any tag filter is set, so you can't accidentally broadcast a sensitive build to the whole list by adding a tag to a few recipients.

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
| Telegram delivery hangs / fails on >50MB | Telegram bot API caps uploads at 50 MB | Route the file through WhatsApp/Slack instead; Telegram still gets the caption via `send_notification`. |
| Slack `not_in_channel` error | Bot user hasn't been invited to the target channel | `/invite @your-bot` in Slack, or set the channel to public. The bot needs `files:write` and `chat:write` scopes. |
| Discord webhook returns HTTP 413 | File above 25 MB on the free tier | Boosted servers raise the limit; otherwise route through Slack or Email. |
| Email "self-signed certificate" error | SMTP server uses a self-signed TLS cert | Set `SMTP_SECURE=false` and use port 587 (STARTTLS), or whitelist the cert in the OS trust store. |
| Teams card renders without facts | Teams admin has disabled Adaptive Cards in webhooks | Use `send_notification` with a plain message — the connector falls back to a text post. |
| IPA parser falls back to filename | Info.plist not at `Payload/<App>.app/Info.plist` | Standard Xcode IPAs are fine. Adhoc / unsigned variants may differ; filename fallback still produces usable output. |
| Watcher misses files | File was written into a subdir matching `ignorePatterns` | Edit `ignorePatterns` in the profile; `set_watch_directory` does not touch ignores. |
| Duplicate deliveries | Watcher re-fires on rename | Leave `stabilityThresholdMs` at ≥ 2000. Gradle sometimes writes, moves, rewrites. |
| "Unknown profile" error | Profile hasn't been created via wizard | Re-run `npm run setup`, or call `configure_channel` with the new profile name. |
| Tag filter excludes all recipients | All recipients are untagged but a `tags` filter was passed | Tag at least one recipient, or omit the `tags` argument to broadcast. By design, untagged recipients don't match any filter. |

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

## Distribution intelligence (Phase 3)

Three opt-in capabilities that surface what changed and who installed it. All three are off by default — flip them on per profile via `set_intel_settings` or the wizard.

### Changelog generation

Set `intel.changelog.enabled = true` and point `repoPath` at the git repo where the build was produced. Every delivery caption gains a *What's changed* section grouping commits between the previous semver tag and `HEAD` by conventional-commit type:

```
What's changed (v2.4.0 → HEAD):
• Features:
  – auth: biometric login
  – search bar on home
• Fixes:
  – crash on cold start
```

Use the `generate_changelog` tool to preview without enabling.

### Crashlytics correlation

A vendor-neutral integration. Provide stats either as a local JSON file or an HTTP endpoint that returns:

```jsonc
{
  "versionName": "2.4.0",
  "crashFreeRate": 0.987,
  "totalCrashes": 14,
  "affectedUsers": 9,
  "topIssues": [{ "title": "NPE in checkout", "count": 6 }]
}
```

Captions then carry a `Stability of v2.4.0` block with crash-free %, total crashes, and the top issue. Operators wire this to BigQuery export, Crashlytics REST, internal analytics — whatever produces the shape.

### Install tracking

Opt-in local HTTP server (default port `7331`) that serves staged builds via unique tokens. Per-recipient mode (`tracking.perRecipient = true`) issues a distinct token per `(channel, recipient)` so install events are attributable.

```
GET /install/<48-char hex token>          # serves the file with content-disposition
GET /install/<48-char hex token>/info     # returns {filename, sizeMB, expiresAt} JSON
GET /healthz                              # liveness probe
```

Events stream to `./.tracking/events.jsonl` (json-lines, easy to tail or import). Constant-time token compare. `X-Forwarded-For` is honored only when `INTEL_TRACKING_TRUST_PROXY=true` (don't trust it on a directly-exposed port).

The server runs alongside the MCP stdio process. Operators expose it however they like — ngrok, Tailscale, cloudflared, or their own reverse proxy. **Captions embed the token URL using `intel.tracking.baseUrl`**, so set that to whatever public URL the recipient should hit.

---

## Roadmap

- **Phase 1 — MVP** ✅ *Shipped.* Telegram + WhatsApp delivery, file watcher, APK/AAB parsing, template renaming, persistent multi-profile config, 9 MCP tools.
- **Phase 2 — Channel expansion** ✅ *Shipped.* Slack (Web API), Discord (webhooks), Email (SMTP), Microsoft Teams (Adaptive Card webhooks). iOS `.ipa` parsing via Info.plist (XML & binary). Multi-recipient tagging across all channels.
- **Phase 3 — Distribution intelligence** ✅ *Shipped.* Changelog generation from git tags (conventional-commit grouping). Vendor-neutral Crashlytics correlation (file or HTTP source). Install tracking with a local HTTP server, per-recipient tokens, and a JSON-lines event log. 5 new MCP tools (14 total).
- **Phase 4 — Cloud & multi-tenant.** Cloud storage backing (S3/R2/GDrive) for builds >50MB. Public install links with expiry. Web dashboard. Multi-tenant SaaS.
- **Phase 5 — Enterprise.** SSO, audit logs, RBAC, on-prem deployment, SOC 2 compliance.

---

## License

MIT © Razeen Shaheed / Webverse Arena
