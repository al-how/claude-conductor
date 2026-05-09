# Siri Voice Chat Implementation Review

## Summary

This note captures the review findings for the Siri voice chat implementation against the plan in `docs/plans/2026-05-09-siri-voice-chat-plan.md`.

The implementation includes the core building blocks, but there are a few correctness gaps around shared session continuity, bootstrap prompting, and failure handling that should be addressed before relying on it in production.

## Findings

### High

#### Voice turns do not share Telegram's effective provider/model state

The voice route does not read `chat_settings`, does not resolve an execution target, and does not pass `providerEnv`. It only forwards `globalModel`.

That means a Telegram chat using sticky OpenRouter or Ollama settings will not be resumed through the same effective provider/session path. Instead, the voice route falls back to the default Claude execution path, which breaks the promised cross-channel continuity.

**References:**

- `src/voice/route.ts`
- `src/main.ts`
- `src/db/index.ts`

### Medium

#### First no-session voice turn is duplicated in the bootstrap prompt

The route saves the user transcript before building the bootstrap prompt. `buildBootstrapPrompt()` then reads recent history and includes that just-saved transcript inside `<conversation_history>`, while also appending the same transcript again as the trailing `Human:` message.

That causes the first voice turn after a missing or cleared Claude session to be sent twice.

**References:**

- `src/voice/route.ts`

#### TTS failure still advances the shared session and persists an unheard reply

The route saves the Claude `sessionId` and persists the assistant message before TTS is attempted. If speaches fails, the HTTP request returns an error, but the shared Claude conversation has already advanced and the assistant turn has already been written to the DB.

On retry, the user is continuing from a reply they never heard.

**References:**

- `src/voice/route.ts`

#### Voice config is not optional in practice when present but disabled

The schema requires `chat_id`, `auth_token`, `stt_url`, and `tts_url` whenever a `voice:` block exists, even if `enabled: false`.

That prevents users from keeping a disabled scaffolded `voice` section in `config.yaml`, which is more strict than the intended "optional but disabled by default" behavior.

**References:**

- `src/config/schema.ts`

## Residual Risk

- Route-level behavior is still largely unverified in tests.
- `tests/voice/` currently covers helper units only:
  - `stt`
  - `tts`
  - `normalize`
  - `stop-words`
- There are no route tests yet for:
  - bearer auth failure
  - multipart parsing and size limits
  - `204` plus `X-Voice-Continue: false`
  - normal `audio/mpeg` success path
  - shared-session continuity with Telegram

## Verification Notes

- `npx tsc --noEmit` completed successfully in review.
- Vitest could not be executed in the current sandbox because Vitest startup failed with `spawn EPERM` while loading `vitest.config.ts`.
