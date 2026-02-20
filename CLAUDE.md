# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claude Conductor is a Docker container that wraps Claude Code CLI with scheduling, messaging, browser automation, and webhook capabilities. It runs on Unraid and provides infrastructure around Claude Code — it does not contain AI logic itself.

The full design spec is at `docs/Claude Conductor.md`.

## Windows Development
- This project runs on Windows (likely with MSYS2/Git Bash). Always use platform-safe path handling: normalize paths, use case-insensitive comparisons, and avoid `shell: true` in spawn calls.
- Test path logic for Windows edge cases (backslashes, drive letters, case sensitivity).

## Architecture

Single Node.js process (the harness) manages triggers and spawns Claude Code CLI sessions as child processes.

**Trigger sources** (Telegram bot, cron scheduler, webhook listener) feed into a **Dispatcher/task queue** (FIFO, one Claude Code session at a time), which spawns `claude -p` with appropriate flags. Priority: Telegram > cron > webhook.

**Key components:**
- **Dispatcher** — task queue with concurrency control (max 1 concurrent session)
- **Telegram Bot** — 1:1 messaging interface (grammy library)
- **Cron Scheduler** — DB-driven scheduled tasks (croner library). Managed via REST API (`/api/cron`), not config YAML.
- **Webhook Listener** — HTTP POST endpoints with auth and prompt templates
- **Playwright Browser** — optional Chromium for automation tasks

## Tech Stack

- **Language:** TypeScript (Node.js)
- **Claude Code invocation:** `claude -p` (print mode — full agent loop, all tools available)
- **Auth:** OAuth via mounted `.credentials.json` (Claude Pro/Max subscription, no API key)
- **Database:** SQLite for conversation history and execution logs
- **Config:** Single `config.yaml` at `/config/config.yaml`
- **Browser:** Playwright with persistent profile

## Build & Test

- `npx tsc --noEmit` — type-check only
- `npx tsc` — full build (emits to `dist/`)
- `npx vitest run` — run all tests

## Claude Code Invocation Patterns

```bash
# Telegram (interactive, user-initiated)
claude -p --continue --dangerously-skip-permissions --output-format stream-json

# Cron (scheduled, read-only default)
claude -p --no-session-persistence --allowedTools "Read,Glob,Grep,WebSearch,WebFetch" --output-format stream-json

# Webhook (external, scoped per route)
claude -p --allowedTools <per-route-config> --output-format json --max-turns 25
```

Working directory for all invocations: `/vault` (mounted Obsidian vault).

- API cron jobs inject results into the Telegram conversation context (`conversations` table) as `[Background: {job_name}]` messages. CLI cron jobs do not — they only route output per the `output` setting. This is intentional: API jobs run outside the dispatcher and need explicit context bridging.

## Claude Code CLI Session Flags

- `--session-id` requires a **valid UUID** (not arbitrary strings like Telegram chat IDs)
- `--session-id` + `--resume` or `--continue` **requires `--fork-session`** — but `--fork-session` creates a new session each time, so repeated use causes "already in use" errors
- For session continuity, use `--continue` (without `--session-id`) — it continues the most recent persistent session
- `--no-session-persistence` (used by cron) prevents those sessions from interfering with `--continue`
- Stream-json output includes `session_id` on every event; capture it from the first event to track sessions
- `--model` flag selects the Claude model. Shorthand aliases (opus/sonnet/haiku) mapped in `src/claude/models.ts`
- Model resolution chain: per-task override > per-source config > global `config.yaml` model > CLI default

## Container Volume Mounts

| Mount | Container Path | Purpose |
|-------|---------------|---------|
| Vault | `/vault` | Obsidian vault (Claude Code working directory) |
| Config | `/config` | Harness config, cron definitions, bot token |
| Data | `/data` | SQLite DB, execution logs, browser profile |
| Claude Config | `/home/claude/.claude` | OAuth credentials, auto memory, skills, user rules |

## API Configuration

- `api.anthropic_api_key` from config.yaml is set on `process.env.ANTHROPIC_API_KEY` at startup so the Agent SDK picks it up. This means it is visible to all child processes (CLI sessions authenticate via OAuth separately). Use `${ANTHROPIC_API_KEY}` env var substitution in config.yaml to avoid storing the key in plain text.

## MCP Servers

- MCP servers are configured at **user scope** (`/home/claude/.claude.json`), not project scope — avoids interactive approval prompts in non-interactive `claude -p` sessions.
- Active servers: n8n, home-assistant, AgentMail. Manage with `claude mcp list/add-json/disable/enable` inside the container.
- Project-scoped `.mcp.json` goes at project root (`/vault/.mcp.json`), NOT inside `.claude/` — Claude Code does not read `.claude/.mcp.json`.
- Cron jobs with `--allowedTools` won't have access to MCP tools unless explicitly listed.

## Implementation Phases

1. **Foundation** — Dockerfile, config loading, Claude Code invocation wrapper, health check
2. **Telegram Bot** — message handling, user allowlist, conversation history
3. **Cron Scheduler** — config parsing, scheduled execution, output routing
4. **Webhooks** — HTTP listener, auth middleware, prompt templates *(not yet implemented — schema only in `src/config/schema.ts`)*
5. **Browser & Polish** — Playwright, noVNC, status dashboard

## Claude Output Schema

Default output format is `stream-json` (line-delimited JSON events). Key event types:
- `system` (subtype `init`) — first event, includes `session_id`, `tools`, `model`
- `assistant` — Claude's response messages and tool use
- `result` — final event with `result`, `text`, `subtype`, `num_turns`, `session_id`
- `subtype: 'error_max_turns'` — turn limit hit (may include partial `result`/`text`)
- `type: 'result'` with no `result`/`text` — finished without response
- Telegram and cron run without `--max-turns` by default; cron jobs can set `max_turns` per-job via the API

## Deployment

- CI builds Docker image on push to master via `.github/workflows/docker-publish.yml`
- Image: `ghcr.io/al-how/claude-conductor:latest` with `GIT_SHA` and `VERSION` baked in at build time via Docker build args
- `npm_package_version` is NOT set when running `node dist/main.js` directly — the version must be passed as a `VERSION` build arg from CI reading `package.json`
- Startup banner shows version and git SHA for deployment verification
- **Container must be recreated (not just restarted) to pick up new images**: `docker stop && docker rm && docker compose pull && docker compose up -d`
- Unraid compose project: `/boot/config/plugins/compose.manager/projects/claude-conductor/`

## Git Worktrees

- Worktrees at `.worktrees/<name>/` do not include `.github/` — create it manually if committing CI workflow changes from a feature branch
- Use `git -C <worktree-path>` for git commands when bash path resolution is unreliable on Windows

## Database

- SQLite schema is inline in `src/db/index.ts` (not a separate `.sql` file)
- `CREATE TABLE IF NOT EXISTS` does NOT add new columns to existing tables — new columns need an explicit `ALTER TABLE` migration in `DatabaseManager.migrate()`
- Migration pattern: use `this.db.pragma('table_info(<table>)')` to check for column existence before `ALTER TABLE ADD COLUMN`

## Logging

- Pretty-print transport (`src/logger-transport.ts`) intercepts structured logs and formats them for the console
- Banner events (`startup`, `shutdown`) and session events use the `msg` field — if the transport hardcodes display text, new fields in the log object won't appear
- When adding new log fields, check both the `logger.info()` call AND the transport formatting

## Cron Execution Modes

- **CLI** (default): Jobs go through the Dispatcher queue → spawns `claude -p` child process. Uses OAuth auth.
- **API**: Jobs call `@anthropic-ai/claude-agent-sdk` `query()` directly, bypassing the Dispatcher. Uses `ANTHROPIC_API_KEY`. Requires `api` config in `config.yaml`.
- `registerCronRoutes` takes an `apiEnabled` flag — rejects `execution_mode: 'api'` jobs at creation/update time if API config is absent.

## Design Constraints

- Single-user, single-bot, single-vault system
- Not a chat UI, framework, or plugin system — thin orchestration only
- Telegram messages capped at 4096 chars (needs chunking for long output)
- Claude Code auto memory is keyed to working directory — keep `/vault` consistent across all invocations
- Harness instructions go in `/vault/.claude/rules/` (modular, path-scoped) rather than a monolithic CLAUDE.md
- Design docs and implementation plans go in `docs/plans/YYYY-MM-DD-<topic>-{design,plan}.md`
