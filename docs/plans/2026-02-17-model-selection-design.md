# Model Selection Design

## Overview

Add configurable model selection to Claude Conductor, allowing different Claude models (opus, sonnet, haiku) to be used per trigger source, per job, or per Telegram message.

## Model Resolution Chain

Priority (highest wins):

1. **Per-task override** — Telegram `/model sonnet do something` or API parameter
2. **Per-source config** — cron job's `model` field, webhook route's `model` field, Telegram sticky `/model sonnet`
3. **Global config** — `config.yaml` top-level `model` field
4. **CLI default** — no `--model` flag passed, Claude Code uses its own default

When resolving, the first non-null value in this chain wins. If nothing is set at any level, `--model` is simply omitted from the CLI args.

## Shorthand Aliases

A utility maps shorthands to full model IDs:

| Shorthand | Full Model ID |
|-----------|--------------|
| `opus` | `claude-opus-4-5-20250514` |
| `sonnet` | `claude-sonnet-4-5-20250514` |
| `haiku` | `claude-haiku-3-5-20241022` |

If the input doesn't match a shorthand, it's passed through as-is (assumed to be a full model ID). No validation — Claude Code CLI will reject invalid IDs itself.

The mapping lives in `src/claude/models.ts` so model version bumps are a one-line change.

## Config & Schema Changes

### config.yaml

```yaml
model: sonnet  # optional, global default

cron:
  jobs:
    - name: daily-review
      schedule: "0 9 * * *"
      prompt: "Review recent notes"
      model: haiku  # optional, overrides global

webhooks:
  routes:
    - name: summarize
      path: /summarize
      model: sonnet  # optional, overrides global
```

### Schema changes

- `ConfigSchema` gets optional `model` field (string)
- `CronJobSchema` gets optional `model` field (string)
- `WebhookRouteSchema` gets optional `model` field (string)

### Database

`cron_jobs` table gets a `model TEXT DEFAULT NULL` column via `ALTER TABLE` migration in `DatabaseManager.migrate()`.

## Telegram `/model` Command

- **Sticky mode:** `/model sonnet` — sets the model for all subsequent messages. Stored in-memory (resets on container restart).
- **Per-message override:** `/model haiku what files changed today?` — uses haiku for just that task, doesn't change sticky setting.
- **Query mode:** `/model` with no args — replies with the current sticky model (or "default" if none set).
- **Reset:** `/model default` or `/model reset` — clears sticky override, reverts to global config.

## Invoke Layer Changes

- `ClaudeInvokeOptions` gets `model?: string` field
- `buildClaudeArgs()` adds `--model <resolved-id>` when model is set
- Model resolution happens at the point of task creation (in bot.ts, scheduler.ts, webhook handler) — not in the invoke layer. The invoke layer just passes through whatever model string it receives.

## Files Affected

| File | Change |
|------|--------|
| `src/claude/models.ts` | New file — shorthand alias map + `resolveModel()` utility |
| `src/claude/invoke.ts` | Add `model` to `ClaudeInvokeOptions`, add `--model` to `buildClaudeArgs()` |
| `src/config/schema.ts` | Add `model` field to `ConfigSchema`, `CronJobSchema`, `WebhookRouteSchema` |
| `src/config/loader.ts` | Pass through global model from config |
| `src/db/index.ts` | Add `model` column to `cron_jobs` table + migration |
| `src/cron/scheduler.ts` | Pass model (job-level or global fallback) to task |
| `src/telegram/bot.ts` | Add `/model` command handler, sticky model state, per-message override parsing |
| `src/server/cron-routes.ts` | Accept `model` in create/update API endpoints |
| `config.example.yaml` | Document new model fields |
