# Ollama Models for Cron Jobs — Design

## Summary

Add Ollama as a model provider for cron jobs, leveraging Claude Code's native Ollama support via environment variables. Ollama models appear alongside Claude models in a grouped dropdown picker. Per-job `allowedTools` configuration is exposed in the UI.

Scope: Cron jobs only (Telegram stays Claude-only for now).

## Approach

Claude Code natively supports Ollama through its Anthropic-compatible API (`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN=ollama`, `ANTHROPIC_API_KEY=""`). Rather than building a new execution mode, we add a **provider** concept to the existing CLI execution path. When a cron job targets an Ollama model, the CLI subprocess gets Ollama-specific env vars.

## Configuration

New `ollama` section in `config.yaml`:

```yaml
ollama:
  base_url: "http://192.168.1.x:11434"
```

Presence of the section enables Ollama features. At startup, the harness checks connectivity to `GET /api/tags` and logs available models. If unreachable, Ollama features degrade gracefully.

## Model Identification

Models stored with `ollama:` prefix in the database (e.g., `ollama:qwen3-coder`). Existing models without a prefix are implicitly Claude.

`resolveModel()` returns a richer object:

```typescript
interface ResolvedModel {
  model: string;                   // "claude-opus-4-6" or "qwen3-coder"
  provider: 'claude' | 'ollama';
  env?: Record<string, string>;    // extra env vars for subprocess
}
```

## CLI Invocation

For Ollama models, the child process gets:

```
ANTHROPIC_BASE_URL=http://192.168.1.x:11434
ANTHROPIC_AUTH_TOKEN=ollama
ANTHROPIC_API_KEY=""
```

The existing `ANTHROPIC_API_KEY` stripping logic runs first, then `ResolvedModel.env` overrides are applied on top (so Ollama's empty string wins).

The dispatcher task interface gains an optional `env?: Record<string, string>` field, passed through to `invoke.ts`.

## Ollama Model Discovery

New route `GET /api/ollama/models`:

- Proxies to Ollama's `GET /api/tags`
- Returns `{ models: [{ name, size, modified_at }], available: boolean }`
- If Ollama not configured or unreachable: `{ models: [], available: false }`
- Only registered if `ollama` config section exists

## Dashboard Model Picker

Replace free-text model input with grouped dropdown:

```
[ (default)          ▾ ]
  ── Claude ──
  opus
  sonnet
  haiku
  ── Ollama ──
  qwen3-coder
  glm-4.7
  ...
  ── Custom ──
  (enter custom model ID)
```

- Fetches Ollama models from `GET /api/ollama/models` on page load
- If Ollama unavailable, Ollama group doesn't appear
- Selecting Ollama model stores with `ollama:` prefix
- "Custom" option reveals text input for arbitrary model IDs
- Jobs table shows model with provider badge

## Per-Job allowedTools

- New `allowed_tools TEXT DEFAULT NULL` column in `cron_jobs` table
- Stored as comma-separated string; null means default set
- Exposed in dashboard create/edit forms as multi-select
- Cron routes accept/validate `allowed_tools` in POST/PATCH
- Applies to all execution modes, not just Ollama

## Error Handling

- **Ollama unreachable at execution:** CLI subprocess fails, error captured in execution log
- **Model not found:** Claude Code reports error, same error path
- **Context window limits:** User's responsibility; 64k minimum recommended
- **Config changes:** Model discovery picks up new base_url on next call; running jobs use enqueue-time config

## Files Affected

| File | Change |
|------|--------|
| `src/config/schema.ts` | Add `ollama` config schema |
| `src/claude/models.ts` | `resolveModel()` returns `ResolvedModel` object |
| `src/claude/invoke.ts` | Merge `env` overrides into subprocess |
| `src/cron/scheduler.ts` | Pass `ResolvedModel` env through to dispatcher |
| `src/dispatcher/index.ts` | Add `env` field to task interface |
| `src/db/index.ts` | Add `allowed_tools` column migration |
| `src/server/cron-routes.ts` | Accept `allowed_tools`, add `/api/ollama/models` |
| `public/index.html` | Grouped model dropdown, allowedTools multi-select |
