# Contributing to Build Delivery MCP Server

Thanks for considering a contribution. This project is the kernel of an emerging mobile build distribution platform, and we're keeping the surface deliberately small. The bar for changes is high, but the path is clear.

This guide is **specific to this repo** — it isn't a generic open-source template. Read it before opening a PR.

---

## Table of Contents

1. [Code of conduct](#code-of-conduct)
2. [Getting set up](#getting-set-up)
3. [Project structure](#project-structure)
4. [Hard invariants — never break these](#hard-invariants--never-break-these)
5. [Coding standards](#coding-standards)
6. [Testing requirements](#testing-requirements)
7. [Commit conventions](#commit-conventions)
8. [Pull request process](#pull-request-process)
9. [How to add a new MCP tool](#how-to-add-a-new-mcp-tool)
10. [How to add a new delivery channel](#how-to-add-a-new-delivery-channel)
11. [How to add a new build format](#how-to-add-a-new-build-format)
12. [Reporting bugs](#reporting-bugs)
13. [Security disclosures](#security-disclosures)
14. [Releases](#releases)

---

## Code of conduct

Be kind. Assume good faith. Critique code, not people. Disagreements are resolved by reasoning from the PRD ([build-delivery-mcp-prd.md](./build-delivery-mcp-prd.md)) — that document is the source of truth for *why* the product looks the way it does.

Harassment, discrimination, or any conduct that makes others feel unwelcome will result in immediate removal from the project. If you see something, raise it privately to the maintainer (`raze.priv@gmail.com`).

---

## Getting set up

### Prerequisites

- **Node.js 20+** (we use `type: "module"` and modern Node APIs)
- **Git** (≥ 2.30)
- **Android SDK build-tools** (optional but recommended — without it, the parser falls back to filename heuristics and you can't validate aapt-path changes)
- A **Telegram bot token** for any change that touches `src/delivery/telegram.ts` end-to-end
- A **spare phone** for any change that touches `src/delivery/whatsapp.ts` end-to-end (QR scan)

### Local setup

```bash
git clone https://github.com/Razepriv/Build-Delivery-MCP-Server.git
cd Build-Delivery-MCP-Server
npm install
npm run build       # tsc → dist/
npm test            # vitest unit tests
npx tsx tests/smoke/e2e-pipeline.ts   # end-to-end smoke
```

Before opening any PR, **all four** of the above must succeed locally.

### Branch from `main`

```bash
git checkout -b feat/short-description
# or
git checkout -b fix/short-description
```

Use the same prefix as the conventional-commit type ([see below](#commit-conventions)).

---

## Project structure

```
src/
  config/      → multi-profile config store + zod schemas
  delivery/    → telegram, whatsapp, captions, parallel router
  history/     → in-memory ring buffer
  parser/      → aapt / aapt2 / bundletool / filename fallback
  renamer/     → template engine + sanitization + collision-safe staging
  setup/       → interactive wizard + CI snippet generators
  tools/       → MCP tool definitions, zod schemas, handlers
  utils/       → logger, Android SDK resolver, fs helpers
  watcher/     → chokidar-based file watcher
  pipeline.ts  → end-to-end orchestration (parse → rename → deliver → history)
  server.ts    → MCP Server wiring (stdio transport)
  index.ts     → process entry (signal handling, dotenv)
  types.ts     → immutable domain types
tests/
  unit/        → vitest unit tests (one file per module)
  smoke/       → end-to-end smoke tests (run with tsx, not vitest)
```

Key boundaries:

- **No top-level mutability.** Module-level state is restricted to caches in `utils/androidSdk.ts` (resolver memoisation) and the in-memory `BuildHistory`. Don't add more without a strong reason.
- **No business logic in tools/handlers.** Handlers validate input, delegate to a service (`pipeline`, `router`, `config`), and format the response. Keep them thin.
- **Captions live in `delivery/captions.ts`.** Never inline format strings into the channel services.
- **Schemas in `config/schema.ts` and `tools/schemas.ts` are the single source of truth for shape.** Don't duplicate fields in handlers — derive them.

---

## Hard invariants — never break these

These are non-negotiable. A PR that violates any of them will be rejected on sight.

### 1. The original build file is never mutated or deleted

This is the single most important promise the product makes. The pipeline is **copy-to-staging → deliver → cleanup-staging**. The watcher must never call `fs.rename`, `fs.unlink`, or `fs.writeFile` against an APK/AAB inside the watched directory. If you're tempted to "just move it", you're wrong — copy it.

The smoke test (`tests/smoke/e2e-pipeline.ts`) explicitly asserts the original file's size after a run. Don't break it.

### 2. Secrets never leak in logs or tool responses

- Bot tokens, session tokens, passwords, and API keys are **truncated to 10 chars** before being logged or returned. See `truncateSecret()` and the redaction format in `src/utils/logger.ts`.
- The `.wwebjs_auth/` directory contains live WhatsApp session credentials. **It must remain in `.gitignore`.** Don't add files inside it to git, ever.
- `config.json` contains live bot tokens. **It must remain in `.gitignore`.** Don't commit example configs with real values — use the `.env.example` pattern instead.
- New secrets must be added to the redaction key list in `src/utils/logger.ts` *and* documented in `.env.example`.

### 3. All MCP tool inputs are validated with zod

Every handler in `src/tools/handlers.ts` starts with a `<Schema>.safeParse(args)` call. No exceptions. Fail with `validationError(parsed.error)` on invalid input, *before* touching the filesystem or network.

When you add a new tool, the schema goes in `src/tools/schemas.ts`. The handler must reject invalid input with a clear message that names the offending fields.

### 4. stdout is reserved for MCP JSON-RPC

The MCP transport speaks newline-delimited JSON over stdout. **Anything you print to stdout will corrupt the protocol stream.**

- All log output goes to **stderr** via `winston` (already configured).
- Never use `console.log` directly. Use `logger.info/warn/error/debug`.
- The interactive setup wizard (`src/setup/wizard.ts`) is the only file allowed to write to stdout, because it doesn't run inside the MCP transport.

### 5. The default profile must always exist

`ConfigStore` guarantees a `default` profile in the schema. Don't allow a flow that deletes or invalidates it. Profile deletion (when added in a future tool) must refuse to remove the currently-set default.

### 6. Parallelism via `Promise.allSettled`, never `Promise.all`

Channel delivery uses `Promise.allSettled` so one channel failing never blocks the other. If you add a new channel or a new fan-out point, use `allSettled`. Never `Promise.all` for delivery — that pattern propagates a single failure as a total failure.

### 7. The aapt path is resolved at runtime

Never hardcode a path to `aapt`, `aapt2`, or `bundletool`. Use the resolvers in `src/utils/androidSdk.ts`, which check `ANDROID_HOME`, `ANDROID_SDK_ROOT`, and platform-specific defaults. If the SDK isn't available, the parser must fall back to `filenameFallback()` — never crash.

---

## Coding standards

### TypeScript

- **Strict mode is on.** Don't loosen `tsconfig.json` to make a type error go away — fix the type.
- **No `any` in application code.** Use `unknown` for untrusted input and narrow it. Use generics when a type depends on the caller.
- **No top-level mutation.** Use `readonly` on interface fields and `Readonly<T>` on parameters where the function shouldn't mutate.
- **Public APIs get explicit types.** Exported functions, classes, and shared utilities must have parameter and return types. Local variables can infer.
- **ESM imports use `.js` extensions** (yes, even though we write `.ts`). That's how `NodeNext` resolution works. If you forget, the build will fail.
- **No barrel re-exports** unless they cross a meaningful module boundary (e.g. `src/parser/index.ts` is fine, but `src/utils/index.ts` would just add indirection).

### File organisation

- Files stay **under 400 lines** in normal cases, **800 lines absolute max**. Extract submodules when you cross 400.
- Functions stay **under 50 lines**.
- Nesting stays **under 4 levels deep**. Use early returns and helper functions.
- One concept per file. Two concepts → split. Three concepts → split harder.

### Error handling

- Always handle errors at the boundary. `try/catch` with `unknown` narrowing.
- User-facing errors (MCP tool responses) are clear, actionable strings that don't leak secrets.
- Server-side errors get a structured log line via `logger.error` with `{ stack: err.stack }`.
- Never silently swallow an error. If you genuinely don't care (e.g. staging cleanup), use `safeRemove()` which logs at debug level.

### Immutability

- Spread to copy: `{ ...config, defaultProfile: name }`.
- Don't reassign function parameters. Don't push to readonly arrays.
- The `ConfigStore` always replaces its internal `config` reference rather than mutating it. Match that pattern in similar stores.

### Logging

- `logger.debug` — verbose runtime detail, off by default.
- `logger.info` — pipeline milestones (build detected, delivery dispatched, etc.).
- `logger.warn` — degraded paths (aapt missing, file size near cap).
- `logger.error` — failures with stack traces.
- **Never log full secrets.** Pass them through `truncateSecret()` first or rely on the winston redact format already configured.

---

## Testing requirements

### Coverage gate

`vitest.config.ts` enforces:

- **80%** lines, statements, functions
- **70%** branches

These are the floor, not the goal. PRs that drop coverage in any category will be blocked.

### Test types and locations

| Type | Location | Run with | When required |
|---|---|---|---|
| Unit | `tests/unit/<module>.test.ts` | `npm test` | Every module. New code without a test fails review. |
| Smoke / e2e | `tests/smoke/<scenario>.ts` | `npx tsx tests/smoke/<scenario>.ts` | Anything that touches the pipeline end-to-end. |
| Manual delivery | n/a | `npm start` + drop file | Required when changing `delivery/telegram.ts` or `delivery/whatsapp.ts`. |

### TDD workflow

We write tests first. Always.

1. **RED.** Write a failing test that describes the new behaviour.
2. **GREEN.** Write the minimal code to pass the test.
3. **REFACTOR.** Clean up while keeping the test green.

If you submit a PR that adds production code without a test, expect to be asked to start over with the test.

### Mocking external services

- **Telegram and WhatsApp**: don't hit the real APIs in unit tests. Mock the client. The smoke test deliberately uses an invalid token to exercise the failure path without spamming a real chat.
- **`aapt`/`bundletool`**: don't mock these. Either the SDK is installed (real path) or the test exercises `filenameFallback`.
- **Filesystem**: use `os.tmpdir()` + `fs.mkdtemp()` for real temp dirs. Mocking `fs` is fragile and hides real behaviour.

### Smoke test invariants

`tests/smoke/e2e-pipeline.ts` asserts the **zero-data-loss invariant**: original file exists with original size after a run. Any change to the pipeline must keep this test green, or it's not landing.

---

## Commit conventions

We use **conventional commits**. The build hook will eventually enforce this; for now it's a social contract.

### Format

```
<type>(<scope>): <short summary>

<body — what changed and why, wrap at 72 cols>

<footer — issue refs, breaking change notes>
```

### Types

| Type | Use for |
|---|---|
| `feat` | A new feature visible to a user or another module |
| `fix` | A bug fix |
| `refactor` | Internal restructure with no behaviour change |
| `docs` | Documentation only |
| `test` | Tests only (or test infrastructure) |
| `chore` | Build/tooling/dependency updates |
| `perf` | Measured performance improvement |
| `ci` | Pipeline / GitHub Actions changes |

### Scopes (loosely)

`config`, `delivery`, `history`, `parser`, `pipeline`, `renamer`, `server`, `setup`, `tools`, `types`, `utils`, `watcher`, plus combinations like `parser,renamer` when one commit straddles them.

### Examples (from this repo's history)

```
feat(parser,renamer): APK/AAB metadata + template rename

- parser/apkParser.ts: prefers aapt2, falls back to aapt; extracts
  application-label, package, version, debuggable (build type), SDK
  versions from aapt dump badging.
- parser/aabParser.ts: bundletool dump manifest XML scraping for AAB.
- renamer/template.ts: placeholder engine. Unknown placeholders survive
  verbatim.
```

```
fix: typecheck errors + filename fallback over-greedy regex

- src/parser/filenameFallback.ts: version regex was consuming '_release'
  as part of the semver and '.apk' as a pre-release suffix. Fix:
  (a) restrict pre-release separator to '-' only,
  (b) strip the file extension before regex matching.
```

### Don'ts

- No "wip", "stuff", or "fix bug" — those waste future-you's time.
- No `--amend` on a pushed branch unless you're rebasing pre-merge and you're the only one on the branch.
- No `--no-verify` to bypass hooks.
- No commits that mix unrelated changes. One concern per commit.

---

## Pull request process

1. **Branch from `main`.** Keep the branch focused on a single change.
2. **Run the gate locally** before pushing:
   ```bash
   npx tsc --noEmit && npm test && npx tsx tests/smoke/e2e-pipeline.ts
   ```
3. **Open a PR** against `main` with a description that covers:
   - What changed (one sentence per area)
   - Why it changed (link the PRD section or issue)
   - How you tested it (commands you ran, channels you exercised)
   - Anything reviewers should specifically look at
4. **Self-review the diff** in the GitHub UI before requesting review. Catch your own typos and dead code.
5. **Address review feedback** with new commits, not force-pushes (unless rebasing for a clean history right before merge — and only after the reviewer has signed off on the content).
6. **Squash on merge** if the branch has noisy intermediate commits. Keep the merge commit message clean and conventional-commit-shaped.

### What blocks a merge

- Failing CI (when CI is added) or failing local gate
- Coverage drop below the configured floor
- An invariant violation from the [Hard invariants](#hard-invariants--never-break-these) list
- Unaddressed CRITICAL or HIGH review comments
- Missing tests for new behaviour
- Secrets accidentally checked in (in any form)

### What doesn't block a merge

- Style nits the reviewer flagged as `nit:` — fix in a follow-up if you prefer.
- Reviewer wants a refactor that's out of scope — open a follow-up issue and link it.

---

## How to add a new MCP tool

Adding a tool is a five-step ritual. Skip a step and the tool either won't dispatch or won't validate.

1. **Define the input schema** in `src/tools/schemas.ts`:
   ```ts
   export const NewToolSchema = z.object({
     requiredArg: z.string().min(1),
     optionalArg: z.number().int().positive().optional(),
   });
   ```

2. **Define the MCP tool descriptor** in `src/tools/definitions.ts`:
   ```ts
   {
     name: "new_tool",
     description: "What this tool does and when to use it.",
     inputSchema: { /* mirrors the zod schema as JSON Schema */ },
   }
   ```

3. **Implement the handler** in `src/tools/handlers.ts`:
   ```ts
   export async function handleNewTool(
     args: unknown,
     ctx: HandlerContext,
   ): Promise<CallToolResult> {
     const parsed = NewToolSchema.safeParse(args);
     if (!parsed.success) return validationError(parsed.error);
     // delegate to a service — never inline business logic here
     // return successResult(...) or errorResult(...)
   }
   ```

4. **Register** in `src/tools/index.ts`:
   ```ts
   const registry: Record<string, ToolHandler> = {
     // ...existing tools
     new_tool: handleNewTool,
   };
   ```

5. **Test** in `tests/unit/handlers.<tool>.test.ts` (or extend the existing handler tests). At minimum: valid input, invalid input, edge case.

Keep handlers under 50 lines. If a handler grows, the work probably belongs in a service.

---

## How to add a new delivery channel

Channels are *not* trivial — they involve external APIs, sessions, and rate limits. Talk to the maintainer before starting.

1. **Add the type** to `ChannelName` in `src/types.ts`. Update every union exhaustively (TypeScript will tell you where).
2. **Build the service** at `src/delivery/<channel>.ts`. It must implement:
   - `isReady(): boolean`
   - `testConnection(): Promise<{ ok: boolean; error?: string }>`
   - `sendDocument(filePath, meta, customMessage?): Promise<DeliveryResult[]>`
   - `sendMessage(message): Promise<DeliveryResult[]>`
   - `shutdown(): Promise<void>`
3. **Add a caption builder** to `src/delivery/captions.ts`. Match the formatting conventions of the channel (HTML for Telegram, markdown for WhatsApp, etc.).
4. **Wire the service** into `src/delivery/router.ts`:
   - Construct it in the `DeliveryRouter` constructor.
   - Add it to `resolveTargets()` and the dispatch switch.
   - Honour size limits via `profile.limits`.
5. **Extend the config schema** in `src/config/schema.ts` and the public types in `src/types.ts`.
6. **Update the wizard** in `src/setup/wizard.ts` to prompt for the new channel's credentials.
7. **Test** with a unit test that mocks the underlying client, plus a smoke test that exercises the failure path.
8. **Update the README** — add the channel to the feature list, the config example, and the troubleshooting table.
9. **Update the PRD** if the new channel introduces new constraints.

A new channel is a feature, so it goes through the same PR review as any other.

---

## How to add a new build format

Currently we support `.apk` and `.aab`. To add (e.g.) `.ipa`:

1. Implement a parser at `src/parser/ipaParser.ts` that extracts the same `BuildMetadata` shape — falling back to filename heuristics when the parsing tool is unavailable.
2. Wire it into `src/parser/index.ts`'s extension switch.
3. Update the default `extensions` in `src/config/schema.ts` if the format should be auto-watched.
4. Add a unit test that covers both the real-tool path (mocked) and the fallback.
5. Update the PRD's "Out of scope (v1)" section if you're moving an item *into* scope.

---

## Reporting bugs

Open a GitHub issue with:

- **Environment**: OS, Node version, `ANDROID_HOME` set or not, channel(s) involved.
- **Reproduction**: minimal steps. Include a synthetic APK or filename if it's a parser bug.
- **Expected vs actual**: what you thought would happen, what did happen.
- **Logs**: the relevant section from `./logs/combined.log`, with secrets redacted.

If the bug is in the **delivery path** (Telegram or WhatsApp), include the delivery result JSON from `get_build_history`. The error string in there is usually the smoking gun.

---

## Security disclosures

**Don't** open a public GitHub issue for a security bug. Email `raze.priv@gmail.com` directly with:

- Description of the vulnerability
- Reproduction steps
- Affected version (commit SHA or tag)
- Your suggested fix, if you have one

We'll acknowledge within 72 hours and coordinate a fix + disclosure timeline.

Particular sensitivity:

- Anything that could expose `config.json`, `.wwebjs_auth/`, or environment variables.
- Anything that lets a malicious build file (crafted APK) execute code outside the parser sandbox.
- Anything in the MCP tool input path that bypasses zod validation.

---

## Releases

Releases are tagged on `main` with semver:

- **Major** (`v2.0.0`) — breaking changes to the config schema, MCP tool contracts, or invariants.
- **Minor** (`v1.1.0`) — new features (channels, tools, build formats) without breaking existing ones.
- **Patch** (`v1.0.1`) — bug fixes, dependency bumps, doc updates.

The release notes follow the conventional-commit log between tags. Notable changes get a one-paragraph summary at the top.

---

## Questions?

If something here is unclear, that's a documentation bug — open an issue. The fastest way to improve this guide is to be the contributor it confused.

Thanks for being here. Now go drop a build.

— Razeen Shaheed / Webverse Arena
