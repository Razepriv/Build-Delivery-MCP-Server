# 📦 Build Delivery MCP Server — Product Requirements Document

**Version:** 1.0
**Owner:** Razeen Shaheed / Webverse Arena
**Status:** Draft for implementation
**Last updated:** April 25, 2026

---

## 1. Executive Summary

**Build Delivery MCP** is a Model Context Protocol server that automates the "last mile" of mobile CI/CD: the moment a build finishes and somebody has to rename it, tag it, and drop it into the right chat. It watches a build directory, extracts real metadata from the APK/AAB, renames the file using a configurable template, and delivers it through **Telegram** (Bot API) or **WhatsApp** (QR-based session via `whatsapp-web.js`).

Positioned as a developer tool first, this is the kernel of a broader mobile build distribution platform. The MVP is deliberately scalpel-shaped: solve the renaming + delivery pain end-to-end, with zero human intervention per build.

---

## 2. Problem Statement

Every mobile dev team repeats the same loop after every build:

1. Gradle/Xcode finishes → spits out `app-release.apk`
2. Someone manually renames it to something meaningful
3. Someone drops it into the client's Telegram group or the QA WhatsApp thread
4. Someone in the group asks "which version is this?"
5. Repeat 10–50 times per week, per project

This is pure dead time. It's also error-prone — wrong files get sent, versions get mislabeled, and builds sit in "Downloads" folders forever. For an agency like Webverse Arena shipping across India, Malaysia, and Southeast Asia, this loop gets multiplied by every active client.

---

## 3. Target Users

| Persona | Context | Pain |
|---|---|---|
| **Agency dev lead** | Shipping 5–15 active client apps | Repetitive manual delivery, naming chaos across clients |
| **Solo mobile dev / indie** | Sharing beta builds with testers | "Here's the new build" + attach every time |
| **QA / PM** | Receives builds | Never sure which version is the latest |
| **Client stakeholder** | Non-technical, reviews builds on phone | Just wants a WhatsApp file, clearly named |

Primary persona is the agency dev lead — that's where the pain compounds hardest and where the willingness to adopt automation is highest.

---

## 4. Product Vision

> *Drop a build. Get it renamed, captioned, and delivered to the right chat in under 5 seconds. No tickets, no scripts, no human touch.*

The MCP server is designed to be invoked from any MCP-compatible client (Claude Desktop, Cursor, Claude Code) and also to run passively as a file-watcher daemon. Both modes share the same core pipeline.

---

## 5. Core Features (MVP)

### 5.1 Automatic build detection
A `chokidar` file watcher monitors one or more configured directories for new `.apk` and `.aab` files. It debounces writes (waits for file size to stabilize) before processing, so it never tries to send a half-written build.

### 5.2 Real metadata extraction
- **APK** → parsed via `aapt` / `aapt2` (resolved from `ANDROID_HOME/build-tools`) with a safe fallback to filename-derived metadata if `aapt` is unavailable.
- **AAB** → parsed via `bundletool dump manifest` when available.
- **Extracted fields:** `appName`, `packageName`, `versionName`, `versionCode`, `buildType` (release/debug, inferred from `debuggable` flag), `minSdkVersion`, `targetSdkVersion`, `fileSize`.

### 5.3 Template-based renaming
Configurable filename pattern with placeholder substitution. Default pattern: `{appName}_v{version}_{buildType}_{date}_{time}`. The file is **copied** to a staging directory — the original is never mutated or deleted. This is non-negotiable; data loss is unacceptable.

**Supported placeholders:** `{appName}`, `{version}`, `{versionCode}`, `{buildType}`, `{package}`, `{date}`, `{time}`, `{timestamp}`, `{year}`, `{month}`, `{day}`.

### 5.4 Multi-channel delivery

**Telegram** uses the Bot API via `node-telegram-bot-api` (or `telegraf`). Delivery is a `sendDocument` call with a rich HTML caption containing app name, version, size, timestamp, and any custom message.

**WhatsApp** uses `whatsapp-web.js` with `LocalAuth` session persistence. First run prints a QR code to the terminal for the user to scan with their phone; subsequent runs restore the session automatically from disk. Files are sent via `MessageMedia.fromFilePath()` with a caption.

This is explicitly **not** Twilio or Meta Cloud API. QR-based was chosen because:
- No business verification required
- No per-message pricing
- Works with any personal or business WhatsApp number
- Zero friction to set up for agencies

### 5.5 Persistent configuration
Config is stored in a JSON file (`./config.json` by default, overridable via `CONFIG_PATH`). Environment variables can bootstrap the config on first run. The config store is the single source of truth for channel credentials, default channel, naming pattern, and watch directories.

### 5.6 Build history
Every delivered build is appended to an in-memory ring buffer (last 100 builds) with timestamp, metadata, renamed filename, and per-channel delivery status. Exposed via the `get_build_history` MCP tool.

### 5.7 Delivery resilience
- File size validation (default cap: 50MB, configurable; Telegram's own limit is 50MB for bots, 2GB for premium).
- Per-channel timeout (120s default for large documents).
- Delivery to multiple channels runs in parallel via `Promise.allSettled` — one channel failing never blocks the other.
- Staging files are cleaned up after successful delivery.

---

## 6. Technical Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    MCP CLIENT (Claude, Cursor)              │
└──────────────────────────┬──────────────────────────────────┘
                           │ stdio
┌──────────────────────────▼──────────────────────────────────┐
│                 BUILD DELIVERY MCP SERVER                   │
│                                                             │
│  ┌──────────────┐   ┌─────────────┐   ┌─────────────────┐  │
│  │ File Watcher │──▶│ APK Parser  │──▶│ File Renamer    │  │
│  │ (chokidar)   │   │ (aapt/aab)  │   │ (template-based)│  │
│  └──────────────┘   └─────────────┘   └────────┬────────┘  │
│                                                │            │
│  ┌──────────────┐   ┌─────────────┐   ┌───────▼─────────┐  │
│  │ Config Store │   │ Build       │   │ Delivery Router │  │
│  │ (JSON + env) │   │ History     │◀──│ (parallel fan)  │  │
│  └──────────────┘   └─────────────┘   └───────┬─────────┘  │
│                                                │            │
│            ┌───────────────────────────────────┤            │
│            ▼                                   ▼            │
│  ┌──────────────────┐              ┌──────────────────┐    │
│  │ Telegram Service │              │ WhatsApp Service │    │
│  │  (Bot API)       │              │  (whatsapp-web   │    │
│  │                  │              │   .js + QR auth) │    │
│  └──────────────────┘              └──────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### 6.1 Component responsibilities

| Component | Responsibility |
|---|---|
| **File Watcher** | Detect new builds, debounce writes, hand off to parser. |
| **APK Parser** | Extract metadata from `.apk` via `aapt`, from `.aab` via `bundletool`. Falls back to filename heuristics. |
| **File Renamer** | Apply template, sanitize, ensure uniqueness, copy (not move) to staging. |
| **Config Store** | Load/save/validate config. Single source of truth for credentials and preferences. |
| **Delivery Router** | Pick channel(s), dispatch in parallel, aggregate results. |
| **Telegram Service** | Bot API wrapper: `sendDocument`, `sendMessage`, test connectivity. |
| **WhatsApp Service** | `whatsapp-web.js` wrapper: QR auth, session restore, `MessageMedia` send. |
| **Build History** | In-memory ring buffer with optional disk persistence. |

---

## 7. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript (Node 20+) | Type safety across service boundaries; matches Razeen's existing stack |
| MCP SDK | `@modelcontextprotocol/sdk` ^1.12 | Canonical |
| File watching | `chokidar` ^3.6 | Battle-tested, handles rename/move edge cases |
| Telegram | `node-telegram-bot-api` or `telegraf` | Either works; `telegraf` has richer middleware if we add bot commands later |
| WhatsApp | `whatsapp-web.js` ^1.23 + `qrcode-terminal` | QR-based, no API cost, session persisted via `LocalAuth` |
| APK parsing | `aapt` / `aapt2` (external), `bundletool` (external) | Canonical Android tooling |
| Validation | `zod` ^3.23 | Runtime schema validation for MCP tool inputs |
| Logging | `winston` ^3.11 | Structured logs to console + file |
| FS utils | `fs-extra` ^11 | Safer than stdlib `fs` for copy/ensureDir |
| Config | JSON + `dotenv` | Simple, readable, no database needed for v1 |

---

## 8. MCP Tool Specification

The server exposes these tools over stdio. Each tool returns an MCP-formatted content block; errors return `isError: true` with a human-readable message.

| Tool | Purpose | Required inputs |
|---|---|---|
| `configure_channel` | Set up Telegram or WhatsApp credentials; optionally mark as default. For WhatsApp, this triggers the QR flow if no session exists. | `channel`, channel-specific creds |
| `send_build` | Manually process a build file: parse → rename → deliver. Bypasses the file watcher. | `filePath`, `appName` (optional override), `version` (optional override), `channel` (optional) |
| `process_apk` | Alias for `send_build` triggered by the watcher for full-metadata auto flow. | `filePath` |
| `list_channels` | Report configured channels and readiness state. | none |
| `test_channel` | Send a test ping to verify connectivity. | `channel` (optional; uses default) |
| `get_build_history` | Return the last N delivered builds with status. | `limit` (optional, default 10) |
| `send_notification` | Send a freeform text message to configured channels. Useful for build-failed alerts from CI. | `message`, `channels` (optional) |
| `update_naming_pattern` | Hot-swap the filename template without restart. | `pattern` |
| `set_watch_directory` | Add or change the watch directory; restarts the watcher. | `directory` |

---

## 9. Filename Template System

**Default pattern:** `{appName}_v{version}_{buildType}_{date}_{time}`

**Example output:** `webverse_arena_v2.4.1_release_2026-04-25_14-30-25.apk`

### Placeholder reference

| Placeholder | Source | Example |
|---|---|---|
| `{appName}` | `application-label` from manifest, sanitized | `webverse_arena` |
| `{version}` | `versionName` | `2.4.1` |
| `{versionCode}` | `versionCode` | `241` |
| `{buildType}` | `debug` / `release` (from `debuggable` flag) | `release` |
| `{package}` | `package` attribute | `com.webverse.arena` |
| `{date}` | `YYYY-MM-DD` | `2026-04-25` |
| `{time}` | `HH-mm-ss` | `14-30-25` |
| `{timestamp}` | Unix ms | `1745582425000` |
| `{year}`, `{month}`, `{day}` | Individual date parts | `2026`, `04`, `25` |

Sanitization rules: app name is lowercased, non-alphanumeric collapsed to `_`, version keeps dots and dashes. Collisions are handled by appending `_1`, `_2`, etc.

---

## 10. Configuration Schema

```jsonc
{
  "defaultProfile": "default",
  "profiles": {
    "default": {
      "defaultChannel": "telegram",
      "telegram": {
        "enabled": true,
        "botToken": "...",
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
    },
    "seri_mediclinic": {
      "defaultChannel": "whatsapp",
      "telegram": { "enabled": false },
      "whatsapp": {
        "enabled": true,
        "sessionPath": "./.wwebjs_auth/seri",
        "recipients": [{ "type": "group", "id": "120363yyy@g.us" }]
      },
      "naming": { "pattern": "seri_v{version}_{date}" }
    }
  }
}
```

Profiles inherit missing fields from `default`; only overrides need to be specified. MCP tools accept an optional `profile` string to target a specific client.

All of these are also overridable via environment variables (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `WATCH_DIRECTORY`, `DEFAULT_CHANNEL`, `MAX_FILE_SIZE_MB`, `CONFIG_PATH`, `NAMING_PATTERN`). Env vars are merged into the JSON config on startup, with JSON taking precedence once written.

---

## 11. Key User Flows

### 11.1 First-time Telegram setup
User calls `configure_channel` with `botToken` + `chatId` → config persisted → `test_channel` confirms delivery → subsequent builds flow automatically.

### 11.2 First-time WhatsApp setup (QR flow)
1. User calls `configure_channel` with `{ channel: "whatsapp", recipients: [...] }`.
2. Server initializes `whatsapp-web.js` client with `LocalAuth`.
3. `qr` event fires → QR code is printed to stderr as ASCII art AND returned in the tool response as a base64 PNG data URL for the MCP client to render.
4. User scans QR with phone (WhatsApp → Linked Devices → Link a Device).
5. `ready` event fires → session is persisted to `./.wwebjs_auth/`.
6. Subsequent server starts skip the QR step entirely and restore the session.

### 11.3 Auto-delivery flow
1. Gradle writes `app-release.apk` to watched directory.
2. Chokidar fires `add` event; watcher waits for write stability.
3. APK parser extracts metadata.
4. Renamer copies to staging with new name.
5. Delivery router sends to all enabled channels in parallel.
6. Staging file deleted, history updated.
7. Total time target: **< 5 seconds** for files under 20MB.

### 11.4 Manual delivery from MCP client
User in Claude Desktop: *"Send the latest release build to the Seri Mediclinic Telegram group."* → Claude invokes `send_build` with the appropriate file path → same pipeline runs → confirmation returned.

---

## 12. Non-Functional Requirements

| Requirement | Target |
|---|---|
| End-to-end latency (20MB APK) | < 5s |
| Max supported file size | 50MB (Telegram bot cap); configurable up to 2GB for WhatsApp |
| Concurrent deliveries | 2 channels × N recipients, fully parallel |
| Crash recovery | WhatsApp session auto-restores; watcher auto-restarts on error |
| Logs | Structured JSON to file, pretty-printed to console |
| Secret handling | Never log full bot tokens or session files; truncate to first 10 chars in responses |
| Platform support | macOS, Linux (primary). Windows best-effort. |

---

## 13. Success Metrics

For a single agency or team:

- **Time saved per build:** baseline ~90 seconds of human handling → target < 5s automated.
- **Delivery success rate:** > 99% on files under size cap.
- **Adoption:** installed in CI pipeline within 1 week of first use.
- **Zero data loss:** original build file is never mutated or deleted.

---

## 14. Roadmap

**Phase 1 — MVP (this PRD)** ✅ *Shipped.*
Telegram + WhatsApp QR delivery, file watcher, APK/AAB parsing, template renaming, persistent multi-profile config, 9 MCP tools.

**Phase 2 — Channel expansion** ✅ *Shipped.*
- Slack via Web API (`@slack/web-api`, `filesUploadV2`, multi-channel routing).
- Discord via webhooks (multipart file upload, native `fetch`).
- Email via SMTP (`nodemailer`, plain-text + HTML body, attachment).
- Microsoft Teams via Adaptive Card webhooks (notifications-only — Teams webhooks cannot accept file attachments; route the artifact through any other channel and let Teams carry the announcement).
- iOS `.ipa` parsing via `Info.plist` (both XML and binary plists supported through `bplist-parser` + `adm-zip`); falls back to filename heuristics on broken archives.
- Multi-recipient tagging across **all** channels (`tags: ["qa-team","internal"]`); `send_build` and `send_notification` accept a `tags` filter to scope delivery. Filter is OR-across-tags; untagged recipients are excluded once a filter is set, preventing accidental broadcasts.
- Per-channel size caps: Slack 1024 MB, Discord 25 MB, Email 25 MB (all configurable).
- Default watch extensions extended to `[".apk", ".aab", ".ipa"]`.

**Phase 3 — Distribution intelligence**
Build-to-build changelog generation from git log between tags. Crash-report correlation (pull Firebase Crashlytics per version). Tester install tracking via unique links.

**Phase 4 — Cloud & multi-tenant**
Cloud storage backing (S3 / R2 / GDrive) for builds > 50MB. Public install links with expiry. Web dashboard. Multi-project support. This is where the SaaS play lives.

**Phase 5 — Enterprise**
SSO, audit logs, role-based access, on-prem deployment, compliance (SOC 2).

---

## 15. Out of Scope (v1)

- iOS `.ipa` metadata extraction (we accept IPAs but don't parse them — filename fallback only).
- Cloud storage upload.
- Web UI / dashboard.
- Multi-tenancy.
- Slack / Discord / email channels.
- Build signing or verification.
- Crash analytics.

---

## 16. Resolved Design Decisions

1. **WhatsApp ToS risk — ACCEPTED for v1.** Ship with `whatsapp-web.js` (QR auth, `LocalAuth` session). The ToS risk is tolerable for agency use on personal/business devices. Revisit when SaaS packaging begins (Phase 4) — at that point add Meta Cloud API as an alternative channel.
2. **Large files (>50MB) — LOCAL-ONLY, DIRECT SEND.** No cloud bucket, no transient links in v1. WhatsApp via `whatsapp-web.js` already supports up to 2GB natively, so large builds route through WhatsApp. For Telegram, the 50MB bot cap is surfaced as a clear, actionable error (the build still completes — it just skips the Telegram channel with a logged reason). Delivery router honours `Promise.allSettled` so one channel exceeding the cap never blocks the other.
3. **Multi-project profiles — IN for v1.** Config supports named profiles (`profiles.<name>` block) so one installation can serve N clients. Each profile has its own Telegram/WhatsApp creds, watch directories, and naming pattern. A `defaultProfile` is resolved at startup; MCP tools accept an optional `profile` arg to target a specific client.
4. **CI integration packaging — INTERACTIVE SETUP + DETAILED README.** The setup wizard (`npm run setup` or first-run) asks the user which CI platform they use (GitHub Actions, GitLab CI, Bitbucket Pipelines, CircleCI, local-only). Based on the answer, the wizard emits a ready-to-paste workflow snippet. The repo ships a comprehensive `README.md` with copy-paste CI examples for each platform, covering the raw CLI invocation path too.

---

## 17. Implementation Notes

- Keep the original file untouched. Always. The rename is a copy-to-staging → send → cleanup-staging flow.
- WhatsApp session directory (`./.wwebjs_auth/`) must be in `.gitignore` — it contains session tokens.
- The `aapt` path must be resolved at runtime from `ANDROID_HOME`, not hardcoded. Fall back gracefully if Android SDK is not installed (filename heuristics still produce usable output).
- Every MCP tool handler must validate input with zod before touching the filesystem or any network.
- Telegram captions use HTML mode; WhatsApp captions use `*bold*` / `_italic_` markdown. Both formatters live in per-service caption builders.
