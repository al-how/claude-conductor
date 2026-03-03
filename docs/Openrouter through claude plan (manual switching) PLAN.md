## OpenRouter-Through-Claude Plan (Manual Switching to Non-Claude Models)

## Problem Statement

Claude Conductor currently depends on Claude Code as its primary execution runtime. When Claude usage limits, rate limits, or account constraints are reached, Telegram and cron workflows can be interrupted even though the orchestration layer is still healthy.

The problem to solve is continuity without replacing the runtime: keep the existing Claude Code-based interaction model, but allow explicit manual switching to a non-Claude model through OpenRouter (for example, an allowlisted Qwen model) from the same interface.

This solution must preserve existing Claude defaults and behavior, avoid hidden routing changes, and provide clear user-controlled provider/model selection so operators can continue work when Claude capacity is constrained.


### Summary
Implement OpenRouter exactly in the style of the integration guide: keep using the `claude` CLI runtime, but switch its backend to OpenRouter via environment variables. Add first-class provider/model controls so you can explicitly switch to OpenRouter models (for example Qwen-family models) in Telegram and cron, while preserving current Claude defaults.

This is not a separate OpenRouter runner. It is one execution path (`invokeClaude`) with provider-specific env injection.

## Product Decisions Locked
1. Integration pattern: Guide-style Claude Code -> OpenRouter via `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`.
2. Switching mode: Manual only (no auto-fallback in this phase).
3. Scope: Telegram + Cron.
4. Model policy: Allowlisted coding models only (selected OpenRouter models, including Qwen options).
5. **Unified Provider Model:** All backends (Claude, Ollama, OpenRouter) use a single `provider` field in config and DB.
6. **Session Continuity:** Provider/model changes do NOT clear Claude session state; only `/clear` resets session/conversation context.
7. **Global Model Default Stays Claude:** Top-level `model` remains the Claude default model only.
8. **Dashboard In Scope:** Provider/model switching for cron must be supported in the dashboard UI in this phase.

## Review Decisions Applied (2026-03-01)
1. Session continuity across model/provider changes:
   - Decision: Keep one ongoing session unless user runs `/clear`.
   - Impact: `/provider` and `/model` handlers must not clear `claude_sessions`; add explicit tests that continuity is preserved across provider/model changes and reset only occurs on `/clear`.
2. Claude remains the global model default:
   - Decision: Global `model` is Claude-only fallback behavior.
   - Impact: Non-Claude providers must not implicitly fall back to global `model`; they require explicit model selection or provider-specific default model.
3. Dashboard support in this phase:
   - Decision: Cron provider/model configuration is first-class in UI, not API-only.
   - Impact: Add provider selector and provider-aware model picker in dashboard create/edit flows; add provider-aware validation messages and route responses needed by UI.

## Behavior Specification

### Provider semantics
1. `provider=claude`:
    - Use normal Claude CLI environment (current behavior).
2. `provider=openrouter`:
   - Still call `claude` CLI.
   - Inject environment variables (per OpenRouter guide):
     - `ANTHROPIC_BASE_URL=https://openrouter.ai/api` (configurable)
     - `ANTHROPIC_AUTH_TOKEN=<openrouter_api_key>`
     - `ANTHROPIC_API_KEY=""` (explicitly empty to ensure `AUTH_TOKEN` precedence)
   - Pass selected model via existing `--model`.
3. `provider=ollama`:
    - Still call `claude` CLI.
    - Inject Ollama environment variables (merging current `ollama:` prefix logic into this architecture).
4. Session continuity:
   - Changing provider does not clear session.
   - Existing `claude_sessions` continuation behavior remains active across provider/model switches.
   - Only `/clear` resets session/conversation state.

### Model semantics
1. Claude provider:
    - Keep existing alias mapping (`opus`, `sonnet`, `haiku`) and pass-through IDs.
   - Resolution fallback chain (highest to lowest):
     - one-off override -> sticky model / job model -> global `model` -> CLI default (omit `--model`).
2. OpenRouter / Ollama providers:
    - Accept model IDs from an allowlist only.
    - Pass model string as-is to `--model`.
    - No Claude alias mapping under non-Claude providers.
    - **Fail-fast validation:** Check model against allowlist BEFORE spawning the CLI.
    - **Backward Compatibility:** If `provider` is null but `model` starts with `ollama:`, the resolver must automatically treat it as `provider: 'ollama'`.
   - Resolution fallback chain (highest to lowest):
     - one-off override -> sticky model / job model -> provider-specific `default_model` -> validation error.
   - **No Claude fallback under non-Claude providers:** top-level global `model` is never used when provider is OpenRouter/Ollama.

### User interaction
1. Telegram:
    - Add `/provider` command:
     - `/provider` -> show current sticky provider.
     - `/provider claude|openrouter|ollama` -> set sticky provider.
     - `/provider default|reset` -> clear sticky provider.
     - `/provider openrouter <prompt>` -> one-off override.
    - **Persistence:** Store sticky provider and model in a new `chat_settings` table (keyed by `chat_id`) to avoid data-loss issues with `claude_sessions`' `REPLACE` pattern.
    - Existing `/model` remains, but validation becomes provider-aware.
    - Provider/model changes via `/provider` or `/model` do not clear session; `/clear` is the only reset mechanism.
2. Cron:
    - Each job can specify `provider` and `model`.
    - If provider omitted, default to global provider (or Claude).
    - **Precedence Rule:** `execution_mode: 'api'` only supports `provider: 'claude'`. `provider: 'openrouter' | 'ollama'` REQUIRES `execution_mode: 'cli'`.
    - **Dashboard Support (required in this phase):** cron create/edit UI exposes provider + provider-aware model controls.

## Public API / Schema / Types Changes

### Config
Add to `ConfigSchema` and `config.example.yaml`:
1. `model?: string` remains the global default model for Claude provider.
2. `provider?: 'claude' | 'openrouter' | 'ollama'` (global provider default).
3. `openrouter?:`
    - `api_key: string`
    - `base_url?: string` default `https://openrouter.ai/api`
    - `default_model?: string`
    - `allowed_models: string[]` (required when openrouter enabled).
4. `ollama?:`
    - `base_url?: string`
    - `default_model?: string`
    - `allowed_models: string[]` (required when provider=ollama).

### Cron job model
1. Add `provider?: 'claude' | 'openrouter' | 'ollama'` to `CronJobSchema`.
2. DB migration: add nullable `provider` column to `cron_jobs`.
3. Cron API (`POST/PATCH /api/cron`) accepts/persists `provider`.

### Dashboard/API support for provider UX
1. Extend model discovery route(s) so dashboard can render provider-grouped model options (Claude aliases + OpenRouter allowlist + Ollama allowlist/discovery).
2. Ensure cron route validation errors are provider-aware and UI-consumable (e.g., `api` + non-Claude provider rejection, non-allowlisted model rejection).

### Internal types
1. Extend resolved execution target to include:
    - `provider: 'claude' | 'ollama' | 'openrouter'`
   - `model: string`
   - `providerEnv?: Record<string, string>`
2. Keep `invokeClaude` as the single executor; ensure it correctly merges `providerEnv` with `process.env`.

## Implementation Plan (File-Oriented)

1. `src/config/schema.ts`
   - Add `provider` global field.
   - Add `OpenRouterConfigSchema` and update `OllamaConfigSchema` with `allowed_models`.
   - Add cron `provider`.
2. `src/config/loader.ts`
   - Load and validate OpenRouter and Ollama configs.
3. `src/claude/models.ts`
   - Replace with provider-aware resolver (`resolveExecutionTarget`).
   - Preserve existing Claude alias behavior.
   - Add prefix-based backward compatibility for `ollama:`.
   - Add OpenRouter/Ollama allowlist validation helper.
4. `src/claude/invoke.ts`
   - Ensure `invokeClaude` correctly merges `providerEnv` with `process.env` in `spawn`.
   - Enhance `stream-json` error parsing to be resilient to OpenRouter error formats.
5. `src/telegram/bot.ts`
    - Add sticky provider state and `/provider` command.
    - Load/Save sticky state to new `chat_settings` table.
    - Enqueue tasks with resolved provider/model.
    - Provider-aware `/model` validation.
    - Preserve session continuity across provider/model changes; only `/clear` resets session.
6. `src/cron/scheduler.ts`
    - Resolve provider/model per job using same resolver.
    - For OpenRouter/Ollama jobs, inject provider env into existing `invokeClaude` path.
    - Enforce `execution_mode: 'cli'` for non-Claude providers.
7. `src/server/cron-routes.ts`
    - Accept/validate `provider` and its compatibility with `execution_mode`.
    - Return provider-aware validation errors that dashboard can render directly.
    - Expose provider-grouped model metadata for dashboard selectors.
8. `src/db/index.ts`
    - Migration for `provider` column in `cron_jobs`.
    - Migration for new `chat_settings` table.
    - CRUD updates for provider fields.
9. `src/main.ts`
    - Pass global provider + configs into bot/scheduler.
    - Update runtime rules text to include provider usage examples.
10. `public/index.html`
    - Add provider selector in cron create/edit forms.
    - Add provider-aware model pickers and validation UX.
    - Guardrail UI for `execution_mode` compatibility (`api` only when provider is Claude).
11. `config.example.yaml`
    - Document OpenRouter and Ollama blocks, provider defaults, and allowlist examples.
12. Tests update/add across Telegram, scheduler, schema, DB migration, routes, and dashboard interactions.

## Validation and Failure Modes

### Validation rules
1. If `provider=openrouter` and OpenRouter config/key missing -> explicit error.
2. If OpenRouter/Ollama model not in allowlist -> explicit error.
3. If provider unset -> use global default; if global unset -> Claude.
4. If `execution_mode=api` AND `provider!=claude` -> explicit validation error.
5. If provider is OpenRouter/Ollama and no model resolves from override/sticky/job/provider-default -> explicit error (no fallback to global Claude model).
6. `/provider` and `/model` updates must not clear session state.
7. `/clear` must clear session and conversation state.

### Failure handling
1. Manual switch means no automatic failover.
2. OpenRouter errors (401/429/model-not-found) are surfaced directly in Telegram/cron logs.
3. Existing Claude flows remain unchanged when provider is Claude.

## Test Cases

1. Config validation:
   - valid/invalid OpenRouter config.
   - provider defaults.
2. Resolver tests:
   - Claude alias resolution unchanged.
   - OpenRouter/Ollama allowlist acceptance/rejection.
   - `ollama:` prefix backward compatibility.
3. Telegram command tests:
    - `/provider` query/set/reset/one-off override.
    - Sticky state persistence in `chat_settings` across simulated restarts.
    - `/model` with provider-aware validation.
    - Session continuity across provider/model changes.
    - `/clear` resets session after provider/model changes.
4. Cron tests:
    - Persist and execute jobs with `provider=openrouter`.
    - Legacy jobs without provider still execute as Claude.
    - Validation failure for `api` + `openrouter`.
    - Dashboard-driven create/edit of provider + model values.
5. Invocation tests:
    - OpenRouter provider injects exact env vars required by guide.
    - Claude provider does not receive OpenRouter env.
    - Ollama provider injects Ollama env.
6. API tests:
    - `POST/PATCH /api/cron` with provider field, error and success paths.
    - Provider-aware model metadata endpoint(s) used by dashboard.

## Acceptance Criteria

1. You can set `/provider openrouter` and run a task with an allowlisted OpenRouter model.
2. You can set cron job `provider=openrouter` + model and it executes via `claude` CLI.
3. Switching back to Claude requires only `/provider claude` (or reset).
4. Existing Claude model aliases and workflows are unaffected.
5. No auto-fallback occurs.
6. Provider/model changes keep the same session continuity unless `/clear` is used.
7. Dashboard supports provider + provider-aware model selection for cron jobs in create/edit flows.
8. Global top-level `model` remains Claude default behavior and is not used as fallback for OpenRouter/Ollama.

## Assumptions and Defaults

1. OpenRouter model strings are passed verbatim to `--model`.
2. Non-Claude models may have lower tool/session parity; allowlist mitigates risk.
3. Initial OpenRouter execution remains non-specialized: same dispatcher and Claude CLI plumbing.
4. Future phase can add optional auto-fallback policies after baseline stability.
