# Siri Voice Chat for Claude Conductor

## Context

- Goal: let the user say "Hey Siri, voice chat" and talk to Claude through an iPhone Shortcut.
- Existing assets: Fastify server, dispatcher queue, Telegram session continuity, conversations table.
- Existing external services: Faster Whisper for STT and speaches for TTS on the same Unraid host.
- Non-goals for v1: duplex streaming audio, custom iOS app, concurrent multi-user routing.

## Chosen Design

- Loop-until-stop flow driven by an iPhone Shortcut.
- Shared Claude session with Telegram via the same configured `voice.chat_id`.
- STT uses Faster Whisper's OpenAI-compatible `/v1/audio/transcriptions`.
- TTS uses speaches `/v1/audio/speech`.
- Route returns inline MP3 bytes with `X-Voice-Continue: true|false`.
- Queue remains single-flight and reuses the existing dispatcher.

## Implementation Changes

### Config

Add optional `voice` config with:

- `enabled`
- `chat_id`
- `auth_token`
- `stt_url`
- `stt_model`
- `tts_url`
- `tts_model`
- `tts_voice`
- `stop_words`
- `max_audio_bytes`
- `response_max_chars`

Require `voice.chat_id` for v1. Do not auto-bind to the first Telegram user or the latest session.

### Database

- Add `source` column to `conversations`.
- Update `saveMessage` to accept explicit `source`.
- Pass explicit sources from all writers: `telegram`, `cron`, `voice`.

### Dispatcher and Claude Invocation

- Add `'voice'` to the dispatcher source union for audit/logging.
- Reuse the current `sessionId + resume: true` continuation pattern.
- Do not use `appendSystemPrompt` on a shared Telegram session, to avoid style bleed into later Telegram turns.
- If no Claude session exists, mirror Telegram's DB-history bootstrap before sending the first voice turn.
- Unlike the Telegram bot's fire-and-forget enqueue (`src/telegram/bot.ts:651`), the voice HTTP handler must `await` the dispatcher result. Wrap `dispatcher.enqueue` in a `new Promise<ClaudeResult>` that resolves inside `onComplete` (after `db.saveSessionId` and `db.saveMessage` for the assistant turn) and rejects inside `onError`. Continue with normalization and TTS only after the promise resolves.

### Voice Route

Add `POST /voice/turn` with bearer auth and multipart audio upload.

Behavior:

1. Validate bearer token.
2. Read multipart audio and enforce `max_audio_bytes`.
3. Transcribe with Faster Whisper.
4. Detect empty transcripts and stop phrases.
5. Save the user turn with `source='voice'`.
6. Reuse the configured `voice.chat_id` and current Claude session for continuity.
7. Enqueue the Claude turn through the existing dispatcher.
8. Save the assistant reply with `source='voice'`.
9. Synthesize speech with speaches.
10. Return `audio/mpeg` with `X-Voice-Continue: true`.

Return `204` with `X-Voice-Continue: false` for empty transcripts or stop phrases.

Register the route in `src/main.ts` after `registerSkillsRoutes(app)` (currently line ~165), guarded by `if (config.voice?.enabled)`. Register `@fastify/multipart` once before the route with `{ limits: { fileSize: config.voice.max_audio_bytes } }`. Add `@fastify/multipart` to `package.json` dependencies.

### STT/TTS Helpers

- Add a small STT client for Faster Whisper multipart requests.
- Add a small TTS client for speaches JSON requests.
- Add stop-phrase matching that triggers only on standalone stop phrases or short wrappers, not embedded operational phrases.

### Reply Normalization

- Source the raw assistant text from the existing `extractResponseText` helper (the same one used at `src/telegram/bot.ts:679`).
- Normalize Claude output to speech-friendly plain text before TTS.
- Strip markdown, code fences, and excess whitespace.
- Truncate after normalization using `response_max_chars`.

## iPhone Shortcut

Create one Shortcut named `Voice Chat`:

1. Record Audio.
2. `POST` recorded audio to `https://<host>/voice/turn` with bearer auth. Use a multipart form body with field name `audio` (type File) bound to the recording from step 1. `Content-Type: multipart/form-data` is set by Shortcuts automatically.
3. If status is `204`, speak "Goodbye" and stop.
4. If status is `200`, play the returned audio.
5. If `X-Voice-Continue` is `true`, run the Shortcut again.
6. Otherwise stop.
7. On error, show a notification.

## Test Plan

- Unit tests for STT request shape and error mapping.
- Unit tests for TTS request shape and byte handling.
- Unit tests for stop-phrase detection:
  - `stop` => stop
  - `Bye.` => stop
  - `goodbye claude` => stop
  - `ok stop` => stop
  - `please stop the recording` => continue
  - `stop trying to fix the bug` => continue
- Route tests for auth failure, missing file, oversized file, empty transcript, stop phrase, normal success.
- Integration checks for:
  - `source='voice'` DB writes
  - cross-channel continuity between voice and Telegram
  - no-session bootstrap from DB context
  - `audio/mpeg` and `X-Voice-Continue` behavior

## Risks and Non-Goals

- Latency comes from STT + Claude + TTS and is accepted in v1.
- No streaming TTS in v1.
- Voice waits behind any active Telegram/cron work.
- TLS, Siri permissions, and remote network exposure are deployment concerns, not code changes.

## Assumptions and Defaults

- Use a single plan doc, not a paired design doc.
- Save it at `docs/plans/2026-05-09-siri-voice-chat-plan.md`.
- Treat this as a v1 implementation plan, not end-user documentation.
- Use the current runtime behavior as source of truth where comments/docs differ, especially for Claude session continuation.
