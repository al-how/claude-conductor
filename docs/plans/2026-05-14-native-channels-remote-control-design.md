# Native Channels & Remote Control — Architecture Reassessment

**Date:** 2026-05-14

## Background

Anthropic is changing `claude -p` (print mode) to bill against API tokens rather than subscription. Claude Conductor was built around `claude -p` with OAuth authentication, deliberately stripping `ANTHROPIC_API_KEY` from child processes so all sessions used subscription billing. This change breaks that assumption.

While evaluating options, two new Claude Code native features emerged that cover most of what Conductor was built to do — and both use subscription billing, not API billing.

## Native Features That Replace Custom Code

### Remote Control (`claude remote-control`, v2.1.51+)

Connects the Claude iOS/Android app or `claude.ai/code` to a session running on the local machine.

- Start on server: `claude remote-control` → get session URL + QR code
- Scan QR on phone → full two-way control via native Claude app
- Local filesystem, MCP servers, git all remain available
- Push notifications to phone when long tasks finish or need input
- **Auth: claude.ai OAuth only — explicitly does not work with API keys**
- Pro/Max plans; terminal process must stay running

Modes:
- `claude remote-control` (server mode): persistent, supports multiple concurrent sessions, `--spawn worktree` gives each session an isolated git worktree
- `claude --remote-control` / `claude --rc`: interactive session with remote access enabled
- `/rc` from inside an existing session: promotes current session to remote-accessible

### Channels (`claude --channels plugin:telegram@claude-plugins-official`, v2.1.80+)

Pushes events from Telegram, Discord, or iMessage into a running session. Two-way: Claude reads the event and replies back through the same platform.

- First-party plugins: Telegram, Discord, iMessage
- Sessions retain full local filesystem and MCP access
- **Auth: claude.ai OAuth or Console API key — not Bedrock/Vertex/Foundry**
- Must be named in `--channels` flag each session (security gate)
- Sender allowlist via pairing flow

### Combined invocation

```bash
claude remote-control \
  --channels plugin:telegram@claude-plugins-official \
  --dangerously-skip-permissions \
  --name "Claude Conductor"
```

This single command provides: Telegram integration, phone access via Claude app, push notifications, and full local tool access — all subscription-billed.

## What This Replaces in Claude Conductor

| Claude Conductor component | Native equivalent |
|---------------------------|-------------------|
| Telegram bot (grammy) | Channels: `plugin:telegram@claude-plugins-official` |
| Cron scheduler (croner) | Claude Code scheduled tasks (built-in) |
| Dispatcher / task queue | Claude Code manages internally |
| Session continuity (`--continue`, `--resume`, DB tracking) | Remote Control |
| Phone access workflow | Remote Control + Claude app |
| `invoke.ts` subprocess spawner | Not needed |
| `invoke-api.ts` Agent SDK wrapper | Not needed |

## Options Going Forward

### Option A: Thin wrapper (recommended)

Strip Claude Conductor to a service manager. The container's main job becomes starting and keeping alive a single persistent Claude Code process with the right flags.

**What gets removed:** Telegram bot, cron scheduler, dispatcher queue, `invoke.ts`, `invoke-api.ts`, session DB tracking.

**What stays:** Docker container, OAuth credential mount, config management, thin webhook endpoint for n8n/iOS Shortcuts.

**Effort:** Large removal, small addition. Risk: low — replacing custom code with first-party features.

### Option B: Keep as-is, add API key

Add API key, remove `ANTHROPIC_API_KEY` stripping in `invoke.ts:146`. Everything works as before, costs shift to per-token.

**Effort:** ~5 lines. Risk: low. **Downside:** continues maintaining code that now duplicates native features.

### Option C: Hybrid

Keep Docker/config/lifecycle management, replace application logic. Remove Telegram bot, cron scheduler, dispatcher. Keep a webhook endpoint that spawns sessions for n8n/iOS Shortcuts and returns the session URL.

## Constraints and Caveats

- Remote Control and Channels are **research preview** — `--channels` flag syntax and protocol may change
- Requires Claude Code v2.1.80+ (channels) / v2.1.51+ (remote control)
- Remote Control: local process must stay running; 10-minute network outage causes session timeout
- Channels: events only arrive while session is open — requires always-on process
- Both require claude.ai OAuth; incompatible with `ANTHROPIC_API_KEY`-only auth

## Recommended Next Step

Prototype Option A: start `claude remote-control --channels plugin:telegram@...` as the container's main process (replacing the current Node.js harness entrypoint), verify Telegram pairing works inside Docker, and validate that the OAuth credential mount is sufficient. If stable, proceed with removing the custom Telegram/cron/dispatcher stack.
