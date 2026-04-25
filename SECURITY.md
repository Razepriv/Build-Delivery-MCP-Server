# Security Policy

Build Delivery MCP Server handles **bot tokens, WhatsApp session credentials, and untrusted build artifacts** on behalf of agencies and indie developers. Security issues here are real-world impact, not academic. We take them seriously.

This policy describes how to report a vulnerability, what we consider in scope, the response timelines we commit to, and the security guarantees the project itself enforces.

---

## Table of Contents

1. [Supported versions](#supported-versions)
2. [Reporting a vulnerability](#reporting-a-vulnerability)
3. [What's in scope](#whats-in-scope)
4. [What's out of scope](#whats-out-of-scope)
5. [Our response timeline](#our-response-timeline)
6. [Coordinated disclosure](#coordinated-disclosure)
7. [Built-in security guarantees](#built-in-security-guarantees)
8. [Known risks accepted by design](#known-risks-accepted-by-design)
9. [Operator hardening checklist](#operator-hardening-checklist)
10. [Acknowledgements](#acknowledgements)

---

## Supported versions

Security fixes land on the latest minor release. Older minors are not patched.

| Version | Security fixes |
|---|---|
| `1.x` (current) | ✅ Supported |
| `< 1.0` (pre-release) | ❌ No |

Once `2.x` ships, `1.x` will receive critical-severity fixes for 90 days, then be retired.

If you're running this in production, **pin a tagged version, not `main`**, and watch the [Releases](https://github.com/Razepriv/Build-Delivery-MCP-Server/releases) page for advisories.

---

## Reporting a vulnerability

**Do not open a public GitHub issue for a security bug.** Public issues create a window between disclosure and fix that attackers can exploit.

Use one of these private channels:

### Preferred: GitHub Security Advisories

1. Go to <https://github.com/Razepriv/Build-Delivery-MCP-Server/security/advisories/new>
2. Fill in the template — affected versions, reproduction, impact.
3. We'll be notified privately and respond within the timelines below.

### Alternative: Email

Email **`raze.priv@gmail.com`** with subject `[SECURITY] Build Delivery MCP — <short title>`.

PGP encryption is welcome but not required. If you want a key, request one in the email and we'll exchange before any sensitive material is sent.

### What to include

- **Affected version** (commit SHA, tag, or branch).
- **Reproduction**: minimal, runnable steps. A failing test is gold.
- **Impact**: what an attacker can do, what they need (network access, local access, a crafted APK, etc.).
- **Suggested fix**, if you have one — happy to credit you in the patch.
- **Your preferred name and link** for the [acknowledgements](#acknowledgements) section, or "anonymous" if you prefer.

**Do not include** real bot tokens, real WhatsApp session files, or real customer data in your report. If a token has been exposed, rotate it before sending us anything.

---

## What's in scope

These categories receive priority response:

### Critical

- **Remote code execution** through any MCP tool input or config file path.
- **Arbitrary file read/write** outside the configured staging and watch directories.
- **Bot token / session token leakage** in logs, tool responses, error messages, or transmitted payloads.
- **Authentication bypass** of any kind in WhatsApp session restoration or the MCP transport.
- **Path traversal** via `filePath`, `directory`, or template-rendered filenames.

### High

- **Command injection** in the `aapt` / `aapt2` / `bundletool` invocation paths (`src/utils/androidSdk.ts`, parsers).
- **Zip-bomb / malicious APK** that crashes or hangs the parser/watcher in a way that takes down the server.
- **Insecure deserialisation** of `config.json` or session blobs.
- **Cryptographic weaknesses** in any future credential-storage code (we don't roll our own crypto today, but watch for it).
- **Denial of service** with a small, single-shot input.

### Medium

- **TOCTOU bugs** in the file watcher / staging / cleanup pipeline.
- **Race conditions** that cause the same build to be delivered multiple times, or to the wrong recipient.
- **Resource exhaustion** through unbounded log files, history retention, or session-cache growth.
- **Information disclosure** of internal paths, profile names, or non-secret config in error messages returned to MCP clients.

### Low

- **Missing security headers / hardening** in any future HTTP surface (none today; if added, this becomes High).
- **Unvalidated user input** in non-tool surfaces (the wizard, env-var parsing) where the impact is bounded to the local operator.
- **Outdated dependencies** with known CVEs that aren't actually exploitable in our usage.

---

## What's out of scope

These are not security issues for the purposes of this policy. We're happy to discuss them as feature requests or operational concerns, but they don't qualify for the security disclosure track.

- **`whatsapp-web.js` ToS risk.** Using `whatsapp-web.js` violates Meta's WhatsApp Terms of Service. This is a *product* trade-off documented in the PRD, not a vulnerability. See [Known risks accepted by design](#known-risks-accepted-by-design).
- **Telegram bot 50MB cap.** This is an upstream limit, not a bug.
- **Self-DOS via misconfiguration.** Running the server with broken config, missing dependencies, or a watch directory pointing at `/` is operator error.
- **Vulnerabilities in upstream dependencies** that haven't been triaged for our specific use. Run `npm audit` and open a regular issue if the dep needs bumping.
- **Local privilege escalation** by an attacker who already has the same user as the server process. The threat model assumes the local user is trusted.
- **Social-engineering of the operator** to scan a malicious WhatsApp QR code. We can't fix that from inside the server.

If you're not sure whether something is in scope, **report it privately anyway** and let us decide. Better safe than the alternative.

---

## Our response timeline

We commit to:

| Event | Target |
|---|---|
| Acknowledge receipt of report | **72 hours** |
| Initial triage + severity assignment | **7 days** |
| Patch ready for Critical severity | **14 days** |
| Patch ready for High severity | **30 days** |
| Patch ready for Medium / Low severity | **90 days** |
| Public disclosure after patch | **+14 days** (negotiable) |

If we're going to miss any of these, we'll tell you and explain why.

---

## Coordinated disclosure

The default is **coordinated disclosure**:

1. You report privately.
2. We acknowledge, triage, and develop a fix.
3. We release a patched version with a CVE if warranted.
4. We publish a security advisory crediting you (unless you opt out).
5. The advisory includes a workaround for operators who can't upgrade immediately.

We will **not** disclose your identity or report contents without your consent.

If a vulnerability is being **actively exploited in the wild**, we may shorten the timeline and publish the advisory with a fix or workaround as soon as one exists, even if not all operators have upgraded. We'll tell you before we do.

---

## Built-in security guarantees

These are properties the codebase enforces today. If you find a way to break any of them, that's an in-scope vulnerability.

### Secret handling

- **Tokens are truncated to 10 chars** before being logged or returned in MCP tool responses (`truncateSecret()` in `src/utils/logger.ts`). Full tokens exist only in `config.json` on the operator's local disk.
- **Winston is configured with a redaction format** that scrubs known secret-key fields (`botToken`, `token`, `sessionToken`, `password`, `apiKey`) from log output.
- **`.env`, `config.json`, `.wwebjs_auth/`, and `logs/` are in `.gitignore` by default.** Adding any of them to git is treated as a Critical security issue.

### Input validation

- **Every MCP tool handler validates input with `zod`** before any filesystem or network call. Validation failures return a structured error and never side-effect.
- **Schema is the single source of truth.** Public types in `src/types.ts` and validation schemas in `src/config/schema.ts` / `src/tools/schemas.ts` define every shape the server accepts.

### Filesystem safety

- **The original build file is never mutated or deleted.** The pipeline copies to staging, delivers, and cleans up staging only. Asserted by `tests/smoke/e2e-pipeline.ts`.
- **Filename sanitisation** is applied to template-rendered names: app names lowercase to alphanumeric+underscore, version preserves dots/dashes only, generic fields strip path-unsafe characters.
- **Collision handling** uses `_1`, `_2`, … suffixes — never overwrites an existing file in staging.

### External tool invocation

- **`aapt`, `aapt2`, and `bundletool` are resolved at runtime from `ANDROID_HOME`** and a small allowlist of platform-specific defaults. The path is never user-supplied; the binary name is hardcoded.
- **`execFile` is used (not `exec`)**, so user-controlled inputs cannot be interpreted as shell metacharacters.
- **`maxBuffer` and `timeout` are bounded** on every tool invocation (`64 MB`, `30s`).

### Transport boundary

- **stdout is reserved for MCP JSON-RPC.** Logs and human-readable output go to **stderr**. A bug that prints anything to stdout is treated as a Critical issue (it corrupts the protocol stream).

### Network boundary

- **Telegram delivery uses `telegraf`** with a default 120s timeout per document.
- **WhatsApp delivery uses `whatsapp-web.js`** with `puppeteer` in headless+sandboxed mode (`--no-sandbox --disable-setuid-sandbox` are deliberately disabled to allow operation in containers; if you need stronger isolation, run the server inside its own container).
- **No outbound HTTP/HTTPS calls** are made except by these two libraries to their respective APIs. We do not phone home.

---

## Known risks accepted by design

These are deliberate product trade-offs, not vulnerabilities. They're documented here so reporters know not to file them.

### 1. `whatsapp-web.js` is unofficial

The WhatsApp delivery channel uses the unofficial `whatsapp-web.js` library, which scrapes WhatsApp Web. This violates Meta's WhatsApp Terms of Service. Meta has been known to ban accounts that use it.

**Mitigation:** Operators are warned in the PRD ([§16](./build-delivery-mcp-prd.md#16-resolved-design-decisions)) and the README. A future SaaS deployment will swap to Meta Cloud API. For now, the trade-off (zero setup friction for agencies) is accepted.

### 2. WhatsApp session tokens live on disk

The `LocalAuth` strategy persists session credentials to `./.wwebjs_auth/<profile>/`. Anyone with read access to that directory can hijack the WhatsApp session.

**Mitigation:** `.wwebjs_auth/` is in `.gitignore`. Operators are responsible for filesystem permissions on the directory hosting the server. Don't run the server on a multi-tenant machine where untrusted users have read access.

### 3. `config.json` contains live bot tokens

To avoid prompting on every startup, `config.json` stores Telegram bot tokens at rest in plaintext.

**Mitigation:** `config.json` is in `.gitignore`. Operators can use environment variables instead, which gives them OS-level credential management. A future version may add an encrypted-at-rest config option (see roadmap, Phase 5 enterprise features).

### 4. Crafted APK files reach the parser

The watcher hands every APK in the watched directory to `aapt`/`aapt2`. A malicious APK could potentially exploit a bug in those binaries. We do not parse the APK ourselves.

**Mitigation:** We rely on the security posture of Android SDK build-tools. The parser falls back to filename heuristics if the tool fails or crashes. The pipeline is single-shot per file — a parser crash does not affect other builds. If you discover a bug in `aapt` itself, report it to Google.

---

## Operator hardening checklist

If you're running this server in a production-ish setting, work through this checklist:

- [ ] **Pin a tagged release**, not `main`. Watch the Releases page for advisories.
- [ ] **Run on a dedicated machine or container.** Don't share with untrusted workloads.
- [ ] **Restrict filesystem permissions** on the project directory (especially `config.json` and `.wwebjs_auth/`) to the user running the server.
- [ ] **Use a separate Telegram bot** per project / per profile. Don't share bot tokens across deployments.
- [ ] **Use a dedicated WhatsApp number** for QR sessions if you can. A burner SIM in a spare phone is the safest pattern.
- [ ] **Rotate bot tokens periodically** and immediately if anyone unauthorised had access to `config.json`.
- [ ] **Set `LOG_LEVEL=info`** (the default) in production. `debug` logs more detail than you want in long-term storage.
- [ ] **Rotate `logs/`** regularly. Use `logrotate` or equivalent.
- [ ] **Backup `.wwebjs_auth/`** if you depend on it — losing it means re-scanning the QR.
- [ ] **Don't expose stdio or any port from the MCP server to a network.** This is a local tool; it doesn't bind a TCP port. If you wrap it in something that does, you take responsibility for that surface.
- [ ] **Review `package-lock.json` on every dependency bump.** Run `npm audit`. Treat new vulnerabilities as a triage event.

---

## Acknowledgements

This section will list reporters who have responsibly disclosed security issues.

- *(none yet — be the first)*

If you'd like to be added (or omitted, or anonymised), tell us in your report.

---

## Contact

- **GitHub Security Advisories:** <https://github.com/Razepriv/Build-Delivery-MCP-Server/security/advisories/new>
- **Email:** `raze.priv@gmail.com`
- **Subject prefix:** `[SECURITY] Build Delivery MCP — <short title>`

Last updated: 2026-04-25.
