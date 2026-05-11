# Voice Shortcut -> Telegram Handoff Plan

## Context

- The current voice route keeps the HTTP request open through STT -> Claude -> TTS.
- In practice, iPhone Shortcuts is a poor place to wait for a 1-3 minute Claude turn.
- The repo already has a durable delivery channel: the Telegram bot, shared conversation history, and shared Claude session continuity.

## Problem

- Voice input from Shortcuts is convenient.
- Voice output back to the same Shortcut is fragile because the phone may lock, the Shortcut may time out, or iOS may suspend it.
- The user's actual requirement is not "always get audio back into Shortcuts." It is "capture a voice prompt quickly, then receive the answer reliably without babysitting the screen."

## Chosen Design

- Keep the iPhone Shortcut as a thin voice-capture client.
- Keep STT in the `/voice/turn` request so the server can confirm what was heard before queueing work.
- After STT, enqueue the Claude turn in the background on the existing dispatcher.
- Deliver the final answer to Telegram, not back to the Shortcut response body.
- Treat Telegram as the guaranteed delivery channel for long-running voice turns.

This is intentionally a modality handoff:

1. Voice in via Shortcut.
2. Text/transcript into Claude Conductor.
3. Text reply out via Telegram.
4. iPhone receives the normal Telegram notification on the lock screen.

## Goals

1. User can trigger a voice prompt from Siri or Shortcuts and put the phone away immediately.
2. Claude turns can take several minutes without breaking the experience.
3. Cross-channel continuity with the paired Telegram chat remains intact.
4. Delivery uses existing infrastructure instead of new push or app work.

Non-goals:

- Returning synthesized audio to the Shortcut.
- Keeping a live duplex voice loop open on the phone.
- Native iOS push integration.
- Multi-user routing beyond the current single-user design.

## User Experience

### Happy path

1. User says "Hey Siri, voice chat" or runs the Shortcut manually.
2. Shortcut records audio and uploads it to `/voice/turn`.
3. Server transcribes the audio and saves the user turn as `source='voice'`.
4. Server immediately returns `202 Accepted` with the transcript and a delivery hint such as `delivery: "telegram"`.
5. Shortcut speaks "Sent to Claude. Reply will arrive in Telegram." and exits. This spoken confirmation is required, not optional — without it the user has no signal that the upload succeeded.
6. Claude runs in the background through the existing dispatcher.
7. When the reply is ready, the bot sends a Telegram message to the configured chat.
8. Telegram notifies the phone in the usual way.

### Stop phrase / empty transcript

- If the transcript is empty or matches a stop phrase, the route returns `204 No Content`.
- Shortcut keeps the current "Goodbye" behavior and exits locally.

### Failure path

- If STT fails, the route returns a normal HTTP error and the Shortcut can show a local failure notice.
- If Claude fails after the request has already returned `202`, the server sends a Telegram error message to the same chat instead of failing silently.

## Why this instead of async polling

- Polling still makes the Shortcut responsible for waiting.
- Telegram already solves background delivery and lock-screen notifications.
- This architecture matches the real duration of Claude tasks instead of pretending they are interactive voice-assistant latency.
- It removes the most failure-prone part of the system without changing the shared Claude-session model.

The async polling plan in `docs/plans/2026-05-11-voice-async-response-plan.md` remains a viable alternative, but this handoff plan is the preferred direction for reliable unattended use.

## HTTP Contract

`POST /voice/turn`

- Request body: raw audio or multipart audio, unchanged from the current route.
- Auth: existing bearer token.
- Behavior:
  - Parse audio.
  - Run STT.
  - Detect empty transcript / stop phrase.
  - Save user message to DB.
  - Queue a background Claude task.
  - Return quickly without waiting for Claude or TTS.

Responses:

- `202 Accepted`

```json
{
  "accepted": true,
  "transcript": "Remind me what I was testing",
  "delivery": "telegram"
}
```

- `204 No Content` for empty transcript or stop phrase.
- `400 / 401 / 413 / 502` for the same request-time errors the route already exposes.

No polling endpoint is required in this design.

## Background Execution Flow

After a successful `202` response:

1. Resolve execution target using the same chat-scoped provider/model logic as the current voice route.
2. Enqueue the Claude turn on the existing dispatcher.
3. Reuse the shared Telegram session UUID if present.
4. On success:
   - Persist the captured session ID.
   - Save the assistant reply to DB with `source='voice'`.
   - Send the reply to the configured Telegram chat.
5. On failure:
   - Log the failure.
   - Send a Telegram error message so the user knows the request did not vanish.

Important behavioral point:

- Delivery is text-first through Telegram.
- TTS is not part of the critical path for this plan.
- We should not synthesize audio unless we explicitly decide to send Telegram voice/audio messages later.

## Telegram Delivery

### Initial version

- Always echo the transcript to Telegram first, prefixed with `[Voice]`, so the user can confirm what Whisper heard. This is non-optional — it doubles as the only confirmation that the upload reached the server, complements the Shortcut's spoken confirmation, and gives a searchable history of what was asked.
- Send the final assistant reply as a separate normal Telegram text message after Claude completes.

Example:

```text
[Voice] Remind me what I was testing
```

```text
You were testing whether the Shortcut could survive a long-running Claude turn...
```

Sending the transcript and the reply as two separate messages (rather than one combined message) means the user sees their question appear in the chat immediately, which matches how a typed Telegram exchange already feels.

### Error delivery

- On Claude failure, send a concise bot message such as:

```text
[Voice] Sorry, that voice request failed: <reason>
```

### Optional later enhancement

- Add Telegram `sendVoice` or `sendAudio` support and deliver synthesized speech as a voice note in addition to or instead of text.
- This is explicitly out of scope for the first handoff implementation.

## File Changes

- `src/voice/route.ts`
  - Extract the post-STT Claude execution into a detached helper.
  - Change the route to return `202` after STT + DB save + enqueue, not after Claude/TTS completion.
  - Remove TTS from the request-response path.
  - Add Telegram delivery on background completion/failure.
- `src/main.ts`
  - Pass whatever Telegram-sending dependency is needed into `registerVoiceRoutes`.
- `src/telegram/bot.ts`
  - Reuse the existing bot send path if possible.
  - If needed, expose a small delivery surface beyond `sendMessage()` for voice-originated completions.
- `tests/voice/route.test.ts` (new)
  - `202` happy path with transcript + delivery hint.
  - `204` stop phrase / empty transcript.
  - no synchronous wait for Claude completion.
  - background success sends Telegram message and persists assistant turn.
  - background failure sends Telegram error message and does not fail the already-accepted HTTP request.
- `shortcuts/VoiceChat.shortcut`
  - Update the Shortcut to stop expecting an MP3 response body.
  - Show a confirmation message and exit after successful upload.

## Shortcut Changes

The Shortcut should become much simpler:

1. Record audio.
2. POST audio to `Voice chat URL`.
3. If response is `204`, speak "Goodbye" and stop.
4. If response is `202`, speak "Sent to Claude. Reply will arrive in Telegram." This is mandatory — it is the only feedback the user gets that the upload worked before the Shortcut exits.
5. End.

This keeps the Shortcut short-lived and avoids any polling loop.

## Data and Session Behavior

- Continue using the configured `voice.chat_id` as the bridge to the shared Telegram conversation.
- Save the voice transcript as a user turn with `source='voice'`.
- Save the assistant reply after Claude completes, also with `source='voice'`.
- Continue persisting the Claude session UUID only after a successful assistant completion.

That preserves the main benefit of the current architecture: voice and Telegram remain part of one shared ongoing conversation.

## Risks

- **Mixed modality may surprise the user**: the reply arrives in Telegram rather than as spoken audio. This should be made explicit in the Shortcut copy.
- **Telegram notification settings become part of the UX**: if Telegram notifications are muted, the user may think nothing happened.
- **Voice requests can still queue behind other work**: this is acceptable and already true in the dispatcher model.
- **Accepted request, later failure**: must be surfaced in Telegram so the request does not appear to disappear.

## Open Questions

- Should we later add Telegram voice-note delivery via `bot.api.sendVoice`, using the existing speaches TTS pipeline? Out of scope for v1 but the TTS code and `tts_url`/`tts_model` config should be left in place so this is a small follow-up rather than a rewrite.

## Verification

- `npx tsc --noEmit`
- `npx vitest run tests/voice tests/telegram`
- Manual Shortcut test:
  - record a short voice note
  - confirm the Shortcut exits quickly after upload
  - confirm a Telegram reply arrives after Claude finishes
- Manual long-running test:
  - trigger a prompt expected to take >2 minutes
  - lock the phone
  - confirm Telegram still delivers the reply

## Out of Scope

- Native iOS app work.
- APNs push notifications.
- Streaming voice responses.
- Polling-based Shortcut audio playback.
- Multi-user voice routing.
