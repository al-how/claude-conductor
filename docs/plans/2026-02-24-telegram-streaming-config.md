# Telegram Streaming Toggle Plan

**Goal:** Add a config flag to enable/disable Telegram message streaming, defaulting to enabled. When disabled, the bot should only send the final response (current behavior). When enabled, stream plain-text edits in-place with throttling and overflow handling, then send the final formatted response.

**Scope:** Telegram bot streaming only. No changes to cron/webhook output.

**Streaming design decisions:**
- **Format:** Stream plain text only (no HTML) to avoid partial markdown/HTML breakage. The final response still goes through `sendTelegramResponse()` for HTML formatting.
- **Rate limits:** Throttle edits to at most once every 1000 ms. If edits fail with 429 or other errors, log and continue; rely on the next scheduled flush.
- **4096-char limit:** Use multi-message streaming. When the buffer exceeds 4096, finalize the current stream message, send a new placeholder message, and continue streaming into it.
- **Final output strategy:** Convert the full response to HTML, chunk it, and send it as final messages (same chunking as `sendTelegramResponse`). After sending final chunks, delete all stream messages to avoid duplication clutter.
- **Tool events:** Ignore tool_use/tool_result for streaming display (no status text). Only stream assistant_text blocks.
- **Async ordering:** Change `onStreamEvent` to return `Promise<void>` and await it in `invoke.ts` to serialize event handling.

**Tech Stack:** TypeScript, Zod, grammy bot

---

### Task 1: Add config flag to schema

**Files:**
- Modify: `src/config/schema.ts` (TelegramConfigSchema)
- Modify: `tests/config/schema.test.ts`

**Step 1: Write the failing tests**

Add tests in `tests/config/schema.test.ts`:

```typescript
it('should accept telegram.streaming_enabled true', () => {
    const result = ConfigSchema.safeParse({
        telegram: { bot_token: 'x', allowed_users: [1], streaming_enabled: true }
    });
    expect(result.success).toBe(true);
    if (result.success) {
        expect(result.data.telegram?.streaming_enabled).toBe(true);
    }
});

it('should default telegram.streaming_enabled to true when omitted', () => {
    const result = ConfigSchema.safeParse({
        telegram: { bot_token: 'x', allowed_users: [1] }
    });
    expect(result.success).toBe(true);
    if (result.success) {
        expect(result.data.telegram?.streaming_enabled).toBe(true);
    }
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/config/schema.test.ts`
Expected: FAIL — `streaming_enabled` not recognized / missing default

**Step 3: Implement**

In `src/config/schema.ts`, add to `TelegramConfigSchema`:

```typescript
streaming_enabled: z.boolean().default(true),
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/config/schema.test.ts`
Expected: PASS

---

### Task 2: Wire config to TelegramBot

**Files:**
- Modify: `src/claude/invoke.ts`
- Modify: `src/telegram/bot.ts`
- Modify: `src/main.ts`
- Modify: `tests/telegram/bot.test.ts`

**Step 1: Write failing tests**

Add tests to verify the bot uses streaming when enabled and skips streaming when disabled. Use existing mocking patterns in `tests/telegram/bot.test.ts`. Include explicit cases:

```typescript
// streaming_enabled true -> onStreamEvent handler is passed to dispatcher.enqueue
// streaming_enabled false -> onStreamEvent is undefined and no editMessageText calls occur
// streaming throttles edits: rapid assistant_text events trigger <=1 edit per throttle window
// streaming overflow: when buffer > 4096, bot sends a new message and continues streaming
// final completion: final HTML response sent in chunks; stream messages deleted
// onComplete clears flushTimer to avoid late edits
```

**Step 2: Implement**

0. Update `onStreamEvent` signature and call site:

In `src/claude/invoke.ts`, change:
```typescript
onStreamEvent?: (event: StreamEvent) => void;
```
to:
```typescript
onStreamEvent?: (event: StreamEvent) => Promise<void>;
```

Await it where used (inside `rl.on('line', ...)`):
```typescript
await onStreamEvent?.({ ... });
```

1. Extend `TelegramBotConfig`:
```typescript
streamingEnabled?: boolean;
```

2. Store the flag in the bot:
```typescript
private streamingEnabled: boolean;
```

Initialize in constructor:
```typescript
this.streamingEnabled = config.streamingEnabled ?? true;
```

3. In `enqueueClaudeTask`, only pass `onStreamEvent` when `streamingEnabled` is true.

4. Implement the streaming handler in `enqueueClaudeTask` when `streamingEnabled` is true:

**State to track:**
```typescript
let streamBuffer = '';
let streamMessageId: number | undefined;
const streamMessageIds: number[] = [];
let lastEditAt = 0;
let flushTimer: ReturnType<typeof setTimeout> | undefined;
const throttleMs = 1000;
```

**Helper functions:**
```typescript
const ensureStreamMessage = async () => {
  if (!streamMessageId) {
    const msg = await ctx.reply('…'); // plain text placeholder
    streamMessageId = msg.message_id;
    streamMessageIds.push(streamMessageId);
  }
};

const flushStream = async () => {
  if (!streamMessageId) return;
  try {
    await ctx.api.editMessageText(ctx.chat!.id, streamMessageId, streamBuffer.slice(0, 4096));
  } catch (e) {
    this.logger?.warn({ err: e }, 'Failed to edit stream message');
  }
};
```

**Event handling (assistant_text only):**
```typescript
onStreamEvent: async (event) => {
  if (event.type !== 'assistant_text') return;
  const text = String(event.data.text ?? '');
  if (!text) return;

  streamBuffer += text;
  await ensureStreamMessage();

  // Overflow handling: finalize current stream message and start a new one
  if (streamBuffer.length > 4096) {
    await flushStream();
    streamBuffer = streamBuffer.slice(4096);
    streamMessageId = undefined;
    await ensureStreamMessage();
  }

  // Throttled edits
  const now = Date.now();
  if (now - lastEditAt >= throttleMs) {
    lastEditAt = now;
    await flushStream();
  } else if (!flushTimer) {
    flushTimer = setTimeout(async () => {
      flushTimer = undefined;
      lastEditAt = Date.now();
      await flushStream();
    }, throttleMs - (now - lastEditAt));
  }
}
```

5. On completion:
- `clearTimeout(flushTimer)` before finalizing.
- Flush the current buffer one last time.
- Convert the final response to HTML, chunk it, and send via `ctx.reply` (reuse `sendTelegramResponse` or inline its logic).
- Delete **all** stream messages in `streamMessageIds` via `ctx.api.deleteMessage`.

6. In `src/main.ts`, pass the config:
```typescript
streamingEnabled: config.telegram.streaming_enabled,
```

**Step 3: Run tests**

Run: `npx vitest run tests/telegram/bot.test.ts`
Expected: PASS

---

### Task 3: Document the config

**Files:**
- Modify: `config.example.yaml`
- Modify: `CLAUDE.md`

**Step 1: Update config.example.yaml**

Add under `telegram:`:
```yaml
  # Stream partial assistant responses to Telegram (edit-in-place while generating)
  streaming_enabled: true
```

**Step 2: Update CLAUDE.md**

Add a note in the Telegram section:
- `streaming_enabled` (default: true) toggles message streaming for the Telegram bot
- Streaming is plain text only; final message is still formatted via HTML

---

### Task 4: Final verification

**Step 1: Run full tests**

Run: `npx vitest run`
Expected: PASS

**Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: No errors

---

### Task 5: Version bump

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update version**

Per repo policy, bump the version number in `CLAUDE.md` in the same commit that adds the feature.
