# Voice Chat — Async Response Plan

## Symptom

- iOS Shortcut "Voice With Claude" records audio, POSTs to `/voice/turn`, but never plays a reply.
- The shortcut falls through to the `If File Size does not have any value` branch and says "Goodbye".
- This happens even though the server-side pipeline completed successfully.

## Evidence

From the user's 2026-05-11 01:57 run (one turn, transcript: "I'm still testing whether this works. Is this working?"):

| Stage | Time | Source |
|-------|------|--------|
| STT POST received | 01:57:53.154 | speaches |
| Whisper transcribed | 01:57:58.323 | speaches (`200 OK`) |
| Claude session queued | 01:57:58 | conductor |
| Claude session complete | 01:59:56 | conductor (**118s**, 1 turn) |
| TTS POST received | 01:59:56.034 | speaches |
| Kokoro generated 18-char audio | 01:59:58.563 | speaches (`200 OK`) |
| HTTP response sent | ~01:59:58 | conductor |

End-to-end: **~125 seconds** between phone POST and `audio/mpeg` body. iOS Shortcuts "Get Contents of URL" drops the connection well before that (empirically ~60s, sometimes longer but very inconsistent), so the phone never reads the body even though the server wrote one.

The unrelated speaches log line `Unexpected streaming transcription response type: <class 'openai.types.audio.transcription.Transcription'>` returned `200 OK` and is not the cause — the transcript reached conductor cleanly.

## Root Cause

`/voice/turn` is synchronous and holds the HTTP request open for the entire STT → Claude → TTS pipeline. With OpenRouter routing voice through `deepseek/deepseek-v4-flash` plus the conductor's CLAUDE.md / `.claude/rules/` / MCP startup overhead per invocation, the Claude leg alone runs 60–200 seconds. The phone's HTTP client times out long before the server can reply.

## Goals

1. Phone always gets a response or a clear "no reply yet, keep waiting" signal within seconds of POSTing.
2. The architecture tolerates Claude turns that legitimately take 1–3 minutes.
3. No new infra (no push, no websockets, no MQ) — just HTTP + the existing SQLite DB.
4. Keep cross-channel session continuity with Telegram intact.

Non-goals: streaming audio, partial-result playback, multi-user routing, push notifications.

## Chosen Design — Async Job + Poll

Split `/voice/turn` into a fast "accept" endpoint and a polling endpoint. The shortcut POSTs the audio, gets a `job_id` in milliseconds, then polls every ~2s for the rendered audio. The Claude+TTS work runs in the background on the existing dispatcher.

### New endpoints

```
POST /voice/turn
  body: audio (raw or multipart, unchanged)
  auth: existing bearer rules
  202 Accepted
    { "job_id": "<uuid>", "transcript": "..." }
  204 No Content    — stop word or empty transcript (unchanged contract)
  401 / 413 / 400 / 502 — unchanged
```

```
GET /voice/result/{job_id}
  auth: same bearer rules
  202 Accepted     — still running (empty body, header X-Voice-Status: pending)
  200 OK           — audio/mpeg body, header X-Voice-Continue: true|false
  404 Not Found    — unknown job id
  410 Gone         — job failed or expired; body { "error": "..." }
```

State lives in memory in a `Map<jobId, VoiceJob>` keyed by UUID. No DB schema change.

```ts
interface VoiceJob {
  id: string;
  chatId: number;
  status: 'pending' | 'ready' | 'failed';
  transcript: string;
  audio?: Buffer;
  error?: string;
  continueLoop: boolean;        // controls X-Voice-Continue
  createdAt: number;
  readyAt?: number;
}
```

Reap entries older than 10 minutes on each lookup (cheap; map stays small because traffic is one user). Cap the map at e.g. 100 entries to be safe.

### Updated voice flow

1. `POST /voice/turn` — keep auth, body parsing, STT, stop-word check exactly as today.
2. If transcript is empty / stop word, return 204 directly (no job created).
3. Otherwise:
   - Generate `job_id = randomUUID()`.
   - Save the user turn to DB immediately.
   - Insert `VoiceJob { status: 'pending', transcript, chatId, continueLoop: true }`.
   - Kick off the Claude + TTS work as a detached async function — do NOT await it inside the handler.
   - Return `202` with `{ job_id, transcript }` right away.
4. Background worker:
   - Resolves execution target (same logic as today).
   - Enqueues to dispatcher; awaits `onComplete` / `onError`.
   - On success, normalises text, calls TTS, stores `audio` on the job, sets `status = 'ready'`, saves session id and assistant message to DB.
   - On any failure (Claude, TTS, save), sets `status = 'failed'` with error message; do NOT persist session id or assistant message (preserves the "TTS failure leaves session retryable" property from the previous review).
5. `GET /voice/result/:id`:
   - Reap stale jobs.
   - If unknown → 404.
   - If `pending` → 202 with `X-Voice-Status: pending`, empty body.
   - If `ready` → 200 `audio/mpeg` with the buffer, header `X-Voice-Continue: true`. Delete the job from the map after sending (single-shot pickup).
   - If `failed` → 410 with `{ error }`.

### Why in-memory and not DB

- One user, one phone, one voice loop at a time. Concurrency is effectively 1.
- Audio is a few hundred KB to a few MB and lives for at most a couple of minutes.
- DB-backed queue would add migration churn and gives us nothing here. If we later add multi-instance deploys we can move to SQLite blobs without changing the HTTP contract.

### File changes

- `src/voice/route.ts`
  - Extract the post-transcript pipeline (target resolve → dispatcher → TTS → DB save) into an internal `runVoiceJob(job)` helper.
  - Add an in-module `voiceJobs: Map<string, VoiceJob>` and a `reapJobs()` function.
  - Rewrite the `POST /voice/turn` handler to register the job and fire-and-forget `runVoiceJob`.
  - Add `GET /voice/result/:id` handler with the response matrix above.
  - Keep multipart/raw parsing, auth, stop-word handling unchanged.
- `tests/voice/route.test.ts` (new)
  - Auth required on both endpoints.
  - POST with stop word → 204, no job created.
  - POST happy path → 202 with `job_id`.
  - GET pending → 202.
  - GET ready → 200 audio + `X-Voice-Continue: true` + job removed afterwards.
  - GET failed → 410 with error.
  - GET unknown → 404.
  - Reap after >10 min removes entries.
- `docs/plans/2026-05-09-siri-voice-chat-plan.md`: add a "v2 async" note pointing to this plan.

### Shortcut changes (`shortcuts/VoiceChat.shortcut` and the live shortcut)

The current `Voice With Claude` shortcut treats `Contents of URL` as the audio. After this change:

1. Record audio.
2. POST audio to `Voice chat URL`. Parse the response as JSON. Extract `job_id` (Dictionary > Get Dictionary Value).
3. If `job_id` is empty (server replied 204):
   - Speak "Goodbye"; exit.
4. Inner `Repeat 60 times` (≈2 minutes of polling at 2s intervals):
   - Wait 2 seconds.
   - `Get Contents of URL` against `<Voice chat URL>/result/<job_id>` (GET, same `Authorization` header).
   - Get response code (Shortcuts exposes `Status Code` via "Get details of …").
   - If status code = 200:
     - Play sound (the `Contents of URL` is the MP3).
     - Exit inner repeat.
   - If status code = 410 or 404:
     - Speak "Something went wrong"; exit outer repeat.
   - Otherwise (202) continue.
5. After inner repeat finishes, continue the outer 10-turn loop (the existing one).

Notes for the shortcut author:
- `Get Contents of URL` returns the response body; to read headers/status, use **Get Details of URL Response** on its output.
- Use the *URL* path concatenation pattern: build the result URL with a Text action that interpolates `Voice chat URL` + `/result/` + `job_id`.
- Keep the existing `Speak Goodbye` branch for the 204 case; just gate it on whether the JSON parse produced a `job_id`.

The repo's `shortcuts/VoiceChat.shortcut` plist should be regenerated to match. That file is documentation; the runtime shortcut on the phone is what actually matters, but keeping the plist in sync is part of this plan.

## Why not just speed up Claude

Worth considering, but insufficient on its own:

- The 118s observed isn't because Claude is slow at "Yes, working fine!" — it's process startup + skill loading + MCP wiring per invocation. Fixing that means stripping CLAUDE.md / `.claude/rules/` / MCP for voice turns, which (a) breaks cross-channel continuity with Telegram and (b) still leaves us at the mercy of the network and any future tool use.
- Even a "fast" voice path will occasionally hit a 60–120s turn (longer prompts, larger context, OpenRouter retries). Sync HTTP from a phone is fundamentally fragile at that timescale.
- Speeding up Claude is a complementary improvement we can do separately — async unblocks the loop today regardless.

## Risks

- **Job leak if poll never happens**: 10-minute reaper and a 100-entry cap.
- **Pickup race if shortcut polls before the worker stores audio**: covered by `status === 'pending'` returning 202.
- **Restart loses jobs**: acceptable — voice loops aren't long-lived; user just retries.
- **Memory pressure from large MP3s**: Kokoro output is ~16 KB/s; even a one-minute reply is ~1 MB. With the 100-entry cap that's ~100 MB worst case, in practice <5 MB.
- **`X-Voice-Continue: false`** (stop word) currently uses 204 on the POST; the new POST returns 202 in the happy path and 204 for stop words, so the existing shortcut "goodbye" branch on empty body still works.

## Open Questions

- Should the GET endpoint also accept `Bearer` via query-string for older shortcut versions? (Default: no, keep header-only.)
- Should we expose the transcript on the GET response (header or JSON) for debug visibility? (Default: yes — `X-Voice-Transcript: <urlencoded>` on the 200 response so the shortcut can show what was heard.)
- Polling interval — 2s vs 1s? (Default: 2s. Kokoro is sub-second; Claude is the long pole; 1s polling buys very little and doubles request volume.)

## Verification

- `npx tsc --noEmit` clean.
- `npx vitest run tests/voice` — existing helper tests still pass; new route tests pass.
- Manual: hit `/voice/turn` with `curl --data-binary @sample.m4a`, capture `job_id`, poll `/voice/result/<id>` until 200, save body, verify it's playable MP3.
- End-to-end on iPhone with updated shortcut: record short utterance, confirm reply plays within ~2 minutes (matches current server-side latency) without a "Goodbye" false stop.

## Out of Scope

- Speeding up Claude / trimming MCP / per-source rule sets — separate plan.
- Streaming partial audio — separate plan.
- DB-backed job storage / multi-instance support — defer until needed.
