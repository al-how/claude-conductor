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
- **Cron Scheduler** — YAML-configured scheduled tasks (croner or node-cron)
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

## Claude Code Invocation Patterns

```bash
# Telegram (interactive, user-initiated)
claude -p --session-id <chat-id> --resume --dangerously-skip-permissions --output-format json --max-turns 25

# Cron (scheduled, read-only default)
claude -p --no-session-persistence --allowedTools "Read,Glob,Grep,WebSearch,WebFetch" --output-format json --max-turns 25

# Webhook (external, scoped per route)
claude -p --allowedTools <per-route-config> --output-format json --max-turns 25
```

Working directory for all invocations: `/vault` (mounted Obsidian vault).

## Container Volume Mounts

| Mount | Container Path | Purpose |
|-------|---------------|---------|
| Vault | `/vault` | Obsidian vault (Claude Code working directory) |
| Config | `/config` | Harness config, cron definitions, bot token |
| Data | `/data` | SQLite DB, execution logs, browser profile |
| Claude Config | `/home/claude/.claude` | OAuth credentials, auto memory, skills, user rules |

## MCP Servers

- MCP servers are configured at **user scope** (`/home/claude/.claude.json`), not project scope — avoids interactive approval prompts in non-interactive `claude -p` sessions.
- Active servers: n8n, home-assistant, AgentMail. Manage with `claude mcp list/add-json/disable/enable` inside the container.
- Project-scoped `.mcp.json` goes at project root (`/vault/.mcp.json`), NOT inside `.claude/` — Claude Code does not read `.claude/.mcp.json`.
- Cron jobs with `--allowedTools` won't have access to MCP tools unless explicitly listed.

## Implementation Phases

1. **Foundation** — Dockerfile, config loading, Claude Code invocation wrapper, health check
2. **Telegram Bot** — message handling, user allowlist, conversation history
3. **Cron Scheduler** — config parsing, scheduled execution, output routing
4. **Webhooks** — HTTP listener, auth middleware, prompt templates
5. **Browser & Polish** — Playwright, noVNC, status dashboard

## Claude JSON Output Schema

With `--output-format json`, Claude returns: `{result?, text?, type, subtype?, num_turns?}`
- `subtype: 'error_max_turns'` — turn limit hit (may include partial `result`/`text`)
- `type: 'result'` with no `result`/`text` — finished without response
- Auto-continuation on max turns is handled in `src/telegram/bot.ts` (max 2 retries)

## Design Constraints

- Single-user, single-bot, single-vault system
- Not a chat UI, framework, or plugin system — thin orchestration only
- Telegram messages capped at 4096 chars (needs chunking for long output)
- Claude Code auto memory is keyed to working directory — keep `/vault` consistent across all invocations
- Harness instructions go in `/vault/.claude/rules/` (modular, path-scoped) rather than a monolithic CLAUDE.md
