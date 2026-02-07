---
created: 2026-02-06
updated: 2026-02-07T15:30
status: false
area:
  - "[[AI]]"
tags:
  - tech/ai
  - tech/docker
  - tech/unraid
  - projects/personal
statusDescription: Discovery
---

# Claude Harness

A lightweight Docker container that wraps Claude Code with scheduling, messaging, browser automation, and webhook capabilities. Runs on Unraid. Inspired by OpenClaw's architecture, but built lean around Claude Code as the engine.

## Problem

Claude Code is powerful but reactive — it only works when you sit down and start a session. There's no way to:

- Reach it from your phone via a messaging app
- Have it run tasks on a schedule (daily reviews, inbox processing)
- Trigger it from external events (webhooks, emails)
- Give it a persistent browser for automation tasks
- Let it run long-lived background work without a terminal open

OpenClaw solves all of this but is a massive project (170k+ stars, monorepo, native apps, 15+ channel adapters, plugin SDK). Most of that complexity isn't needed. What's needed is a thin orchestration layer around Claude Code.

## Core Concept

```
┌─────────────────────────────────────────────────┐
│                 Docker Container                │
│                                                 │
│  ┌───────────┐  ┌──────────┐  ┌──────────────┐ │
│  │ Scheduler  │  │ Telegram │  │  Webhook     │ │
│  │ (cron)     │  │ Bot      │  │  Listener    │ │
│  └─────┬──────┘  └────┬─────┘  └──────┬───────┘ │
│        │              │               │         │
│        └──────────┬───┴───────────────┘         │
│                   │                             │
│           ┌───────▼────────┐                    │
│           │  Dispatcher    │                    │
│           │  (task queue)  │                    │
│           └───────┬────────┘                    │
│                   │                             │
│           ┌───────▼────────┐  ┌──────────────┐  │
│           │  Claude Code   │  │  Playwright   │  │
│           │  (CLI)         │◄─┤  Browser      │  │
│           └───────┬────────┘  └──────────────┘  │
│                   │                             │
│           ┌───────▼────────┐                    │
│           │  Vault + Config│                    │
│           │  (mounted vol) │                    │
│           └────────────────┘                    │
└─────────────────────────────────────────────────┘
```

The container is an orchestrator. It does not contain AI logic — Claude Code handles all reasoning, tool use, and file operations. The harness just provides:

1. **Triggers** — ways to start a Claude Code session (cron, message, webhook)
2. **Infrastructure** — things Claude Code can use during a session (browser, network)
3. **Persistence** — mounted volumes for vault, config, memory, and session logs

## Requirements

### P0 — Must Have

#### R1: Containerized Claude Code Runtime
- Docker container based on Debian/Ubuntu with Node.js, Claude Code CLI, and dependencies
- Claude Code authenticated via **OAuth (Claude Pro/Max subscription)**, not API key
  - OAuth login done once on desktop (`claude login`), credentials stored in `~/.claude/.credentials.json`
  - Container mounts the `.credentials.json` file (contains `accessToken`, `refreshToken`, `expiresAt`, scopes)
  - Claude Code handles token refresh automatically via the `refreshToken`
  - No Anthropic API key or separate billing needed — uses existing subscription
- Vault and config directories mounted as volumes
- CLAUDE.md, skills, agent-files all accessible to Claude Code inside the container
- Health check endpoint (heartbeat)

#### R2: Telegram Bot Interface
- Single Telegram bot for 1:1 messaging with the assistant
- Messages from Telegram → dispatched as Claude Code prompts
- Claude Code output → sent back as Telegram messages
- Support for images/files in both directions
- Allowlist of authorized Telegram user IDs (single-user, no pairing flow needed)
- Conversation context: each Telegram message starts a fresh Claude Code session with relevant context injected (recent conversation history stored locally)

#### R3: Cron Scheduler
- Config file (YAML or JSON) defining scheduled tasks
- Each task specifies: schedule (cron expression), prompt (what to tell Claude Code), and optional output channel (Telegram, log, webhook)
- Tasks run as independent Claude Code sessions
- Execution logs stored persistently
- Examples:
  - `0 7 * * *` — "Review my vault inbox and suggest organization for any new captures"
  - `0 9 * * 1` — "Generate my weekly planning summary based on this week's periodic notes"
  - `*/30 * * * *` — Heartbeat/health check

#### R4: Webhook Listener
- HTTP endpoint that accepts POST requests and dispatches them as Claude Code prompts
- Configurable routes: `/webhook/:name` maps to prompt templates
- Auth via shared secret or bearer token
- Use cases: GitHub webhook on PR → "Review this PR: {payload.url}", Home Assistant event → "The front door was left open for 10 minutes"

### P1 — Should Have

#### R5: Playwright Browser
- Chromium installed in the container with Playwright
- Claude Code can use browser automation skills during sessions
- Persistent browser profile (cookies, sessions survive restarts)
- Optional: noVNC for visual debugging/monitoring of browser sessions

#### R6: Conversation Memory
- Store Telegram conversation history in a local SQLite DB
- Inject last N messages as context when starting new Claude Code sessions from Telegram
- This is strictly **transport-layer context** — a sliding window of recent chat messages for conversational continuity
- Long-term project knowledge (patterns, debugging insights, architecture notes, preferences) is handled by Claude Code's built-in **auto memory** system, which persists across sessions at `~/.claude/projects/<project>/memory/`
- R6 does not need to replicate or supplement auto memory — just provide the recent conversation thread that Claude Code wouldn't otherwise have

#### R7: Task Queue & Concurrency
- Simple task queue (could be as basic as a FIFO with a mutex)
- One Claude Code session runs at a time (prevent resource conflicts and vault race conditions)
- Queued tasks wait with a configurable timeout
- Priority levels: interactive (Telegram) > scheduled (cron) > background (webhook)

#### R8: Output Routing
- Claude Code session results can be routed to: Telegram, log file, webhook callback, or silent (just execute)
- Configurable per trigger source and per cron job
- Telegram messages should be formatted for readability (markdown → Telegram markdown)

### P2 — Nice to Have

#### R9: Web Dashboard
- Simple status page showing: container health, recent task history, cron schedule, active sessions
- Read-only — no configuration through the UI
- Could be as simple as a static HTML page served by the webhook listener's HTTP server

#### R10: Multi-Channel Expansion
- Abstracted channel interface so adding Discord, Slack, or other channels later is straightforward
- Not building these now, but the dispatcher should accept messages from any source with a common shape: `{ source, userId, text, attachments?, replyTo? }`

#### R11: Email Trigger
- Watch a mailbox (IMAP or Gmail API) for incoming emails matching filters
- Dispatch as Claude Code prompts with email body as context
- Reply via the same channel

## Technical Decisions

### Language: TypeScript (Node.js)
- Claude Code is Node-based; same runtime reduces complexity
- Good Telegram bot libraries (grammy or telegraf)
- Playwright has first-class Node support
- Cron libraries are mature (croner, node-cron)

### Single Process vs. Multi-Process
- **Single Node.js process** for the harness (scheduler, bot, webhook listener, dispatcher)
- **Spawned child processes** for Claude Code sessions (`claude --prompt "..."`)
- Simple, debuggable, low resource overhead
- Claude Code CLI handles its own lifecycle; the harness just invokes and captures output

### Claude Code Invocation

Print mode (`claude -p`) runs the **full agent loop** — all tools (Read, Write, Edit, Bash, Glob, Grep, WebFetch, MCP servers, subagents) are available. The only things exclusive to interactive mode are slash commands and the REPL interface. This is the officially documented pattern for programmatic/headless use.

**Base invocation:**
```bash
claude -p "your task here" \
  --output-format json \
  --max-turns 25
```

**Permission strategy (tiered by trigger trust level):**

| Trigger | Approach | Rationale |
|---------|----------|-----------|
| Cron (scheduled) | `--allowedTools "Read,Glob,Grep,WebSearch,WebFetch"` | Read-only by default; specific jobs can opt in to more |
| Telegram (interactive) | `--dangerously-skip-permissions` | User is present and initiated the request |
| Webhook (external) | `--allowedTools` per route config | Scoped to what the webhook needs |

Three permission mechanisms available:

1. **`--allowedTools`** (granular allowlist) — Whitelist specific tools per task. Supports prefix matching: `Bash(git diff *)` allows any `git diff` command. Recommended for cron and webhooks.
2. **`--dangerously-skip-permissions`** (full auto-approve) — Disables all permission prompts. Anthropic's intended use case is Docker containers. Appropriate for Telegram where the user is driving.
3. **`--permission-prompt-tool`** (custom MCP handler) — Forwards approval prompts to your own MCP server. Future option: could route approval requests to Telegram as inline buttons.

**Other relevant flags:**

| Flag | Purpose |
|------|---------|
| `--output-format json` | Parse responses programmatically (structured output with tool calls, costs, etc.) |
| `--output-format stream-json` | Stream tokens in real-time (future: live Telegram updates) |
| `--max-turns N` | Cap agentic loops to prevent runaway sessions |
| `--session-id <uuid>` | Named sessions for Telegram conversation continuity |
| `--continue` / `--resume` | Continue previous conversation |
| `--append-system-prompt` | Inject harness context while keeping CLAUDE.md defaults |
| `--mcp-config <path>` | Load MCP servers (Home Assistant, etc.) per session |
| `--no-session-persistence` | Don't save sessions to disk (for ephemeral cron jobs) |
| `--add-dir <path>` | Give Claude Code access to additional directories outside the working directory (e.g., `--add-dir /config`). CLAUDE.md files from added dirs are not loaded by default unless `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1` is set. |

**Session model:**
- Telegram messages: `claude -p --session-id <telegram-chat-id> --resume` for conversation continuity
- Cron jobs: `claude -p --no-session-persistence` for stateless one-shot execution
- Webhooks: `claude -p` with fresh session per event

**Working directory:** Set to `/vault` (mounted Obsidian vault) so Claude Code's file operations target the vault by default. All invocations should use `/vault` as the working directory to ensure auto memory is keyed to a single project namespace (auto memory is keyed to git root, or working directory if not a git repo).

### Memory Architecture

Claude Code has a built-in memory hierarchy that the harness should leverage rather than replicate:

| Memory Layer | Location | Loaded | Managed By |
|-------------|----------|--------|------------|
| **Auto memory** | `~/.claude/projects/<project>/memory/MEMORY.md` + topic files | First 200 lines of `MEMORY.md` at session start; topic files on demand | Claude Code (automatic) |
| **User CLAUDE.md** | `~/.claude/CLAUDE.md` | Every session | User |
| **User rules** | `~/.claude/rules/*.md` | Every session | User |
| **Project CLAUDE.md** | `/vault/CLAUDE.md` or `/vault/.claude/CLAUDE.md` | Every session | User/team |
| **Project rules** | `/vault/.claude/rules/*.md` | Every session (unconditional rules) or on demand (path-scoped rules) | User/team |
| **Project local** | `/vault/CLAUDE.local.md` | Every session (auto-gitignored) | User |
| **Harness context** | Injected via `--append-system-prompt` | Per invocation | Harness |
| **Conversation history** | SQLite DB (R6) | Injected as prompt context for Telegram sessions | Harness |

**Recommended harness instructions structure** — use `.claude/rules/` in the vault for modular, scoped instructions instead of a monolithic CLAUDE.md:

```
/vault/.claude/rules/
├── harness-context.md      # "You're running inside Claude Harness, a Docker container..."
├── telegram-formatting.md  # "Keep responses under 4096 chars, use Telegram-compatible markdown"
├── vault-operations.md     # "This is an Obsidian vault, respect frontmatter format..."
```

Path-scoped rules are supported via YAML frontmatter with `paths` globs, so rules can target specific vault subdirectories. Rules without `paths` frontmatter apply unconditionally.

**Key constraints:**
- Auto memory `MEMORY.md` is capped at 200 lines in the system prompt — Claude Code manages this by moving detailed notes to topic files
- Auto memory is per-project, keyed to git root (or working directory if not a git repo) — keep working directory consistent across all invocations
- `.claude/rules/` files are discovered recursively and support symlinks

### Persistence (Volumes)

| Mount | Container Path | Purpose |
|-------|---------------|---------|
| Vault | `/vault` | Obsidian vault (read/write) |
| Config | `/config` | Harness config, cron definitions, bot token |
| Data | `/data` | SQLite DB, execution logs, browser profile |
| Claude Config | `/home/claude/.claude` | Claude Code config, OAuth credentials, skills, auto memory (`projects/<project>/memory/`), user-level CLAUDE.md and rules |

> **Note:** The Claude Config volume does double duty — it stores both OAuth credentials and Claude Code's auto memory. If this volume is lost, both authentication and accumulated project knowledge are gone. Back up accordingly.

### Configuration

Single `config.yaml` mounted at `/config/config.yaml`:

```yaml
# Auth: Claude Code OAuth credentials mounted via volume at /home/claude/.claude/
# No API key needed — uses Claude Pro/Max subscription
# Run `claude login` on desktop first, then mount ~/.claude/.credentials.json

telegram:
  bot_token: "..."
  allowed_users: [123456789]

cron:
  - name: morning-review
    schedule: "0 7 * * *"
    prompt: "Review my vault inbox and suggest organization for new captures."
    output: telegram

  - name: weekly-planning
    schedule: "0 9 * * 1"
    prompt: "Generate my weekly planning summary."
    output: telegram

  - name: heartbeat
    schedule: "*/30 * * * *"
    prompt: "Run a quick health check. Verify vault is accessible and report any issues."
    output: log

webhooks:
  - name: github-pr
    path: /webhook/github-pr
    auth: bearer
    secret: ${WEBHOOK_SECRET}
    prompt_template: "Review this GitHub PR: {{payload.pull_request.html_url}}"
    output: telegram

queue:
  max_concurrent: 1
  timeout_seconds: 300
  priority:
    telegram: 1
    cron: 2
    webhook: 3

browser:
  enabled: true
  headless: true
  vnc: false  # set true for debugging
```

## Non-Goals

- **Not a chat UI.** Telegram is the interface. No custom web chat.
- **Not multi-user.** Single user, single bot, single vault.
- **Not a framework.** No plugin SDK, no extension marketplace, no third-party skill registry.
- **Not a replacement for Claude Code.** The harness doesn't add AI capabilities — it adds infrastructure around the existing CLI.
- **Not real-time streaming.** Telegram messages are sent when the Claude Code session completes. No token-by-token streaming to chat.

## Implementation Phases

### Phase 1: Foundation
- Dockerfile with Claude Code, Node.js, basic dependencies
- Config loading and validation
- Claude Code invocation wrapper (spawn, capture output, error handling)
- Heartbeat/health check endpoint
- Basic logging

### Phase 2: Telegram Bot
- Telegram bot with message handling
- User allowlist
- Dispatch messages to Claude Code, return responses
- Image/file pass-through
- Conversation history storage and context injection

### Phase 3: Cron Scheduler
- Cron config parsing and validation
- Task execution on schedule
- Output routing (Telegram, log)
- Execution history logging

### Phase 4: Webhooks
- HTTP listener with route registration
- Auth middleware
- Prompt template rendering with payload data
- Output routing

### Phase 5: Browser & Polish
- Playwright/Chromium installation in container
- Browser profile persistence
- Optional noVNC
- Web dashboard (status page)
- Documentation

## Resolved Questions

1. **~~Claude Code session model~~** — **RESOLVED.** Print mode (`claude -p`) supports the full agent loop: all tools, MCP servers, subagents, everything. The only things exclusive to interactive mode are slash commands and the REPL. Permission handling is solved via `--allowedTools` (granular), `--dangerously-skip-permissions` (full auto-approve for Docker), or `--permission-prompt-tool` (custom MCP handler). See "Claude Code Invocation" section above for the full strategy. Validated by Anthropic's official headless docs and community implementations (seedprod/openclaw-prompts-and-skills).

## Open Questions

1. **Rate limits** — Claude Pro/Max has usage limits (not cost-based billing). Cron jobs and webhook triggers could burn through the daily/hourly allowance. Should the harness track usage and throttle? The `rateLimitTier` field in credentials may be relevant.
2. **Vault locking** — If Claude Code modifies vault files while Obsidian is syncing (via Syncthing), could there be conflicts? May need file-level locking or sync coordination.
3. **Telegram message limits** — Telegram caps messages at 4096 chars. Long Claude Code output needs chunking or summarization.
4. **Error handling** — What happens when a cron job fails? Retry? Alert via Telegram? Just log?
5. **MCP servers** — Claude Code supports MCP tool servers. Should the container run any MCP servers (e.g., Home Assistant MCP) alongside Claude Code, or leave that to external services?
6. **OAuth token lifecycle** — The `.credentials.json` has an `expiresAt` timestamp and a `refreshToken`. Claude Code presumably handles refresh automatically during sessions. But if the container is idle for weeks, does the refresh token itself expire? May need a periodic `claude login --refresh` or similar keepalive. Need to test.
7. **Subscription tier limits** — Pro vs Max have different usage caps. The harness should degrade gracefully when rate-limited (queue and retry, not fail loudly). The `subscriptionType` and `rateLimitTier` fields in credentials could inform this.
