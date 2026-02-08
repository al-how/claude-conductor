# Phase 2: Telegram Bot — Implementation Plan

> **Goal:** Implement the Telegram Bot interface, the centralized task dispatcher, and the SQLite conversation history storage.

**Spec:** `docs/Claude Conductor.md`

## Architecture

- **Dispatcher:** First-in-first-out (FIFO) queue ensuring only one Claude Code session runs at a time.
- **Database:** SQLite database to store conversation history for context injection.
- **Telegram Bot:** `grammy` based bot that validates users, maintains conversation state, and submits tasks to the dispatcher.

## Dependencies

- `grammy` (Telegram Bot Framework)
- `better-sqlite3` (Database)
- `@types/better-sqlite3` (Type definitions)

---

## Task 1: Dependencies & Database

**Files:**
- Modify: `package.json` (add `grammy`, `better-sqlite3`, `@types/better-sqlite3`)
- Create: `src/db/index.ts`
- Create: `src/db/schema.sql` (embedded or file)
- Test: `tests/db/db.test.ts`

**Schema:**
```sql
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  role TEXT CHECK(role IN ('user', 'assistant')) NOT NULL,
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_conversations_chat_id ON conversations(chat_id);
```

**Implementation:**
- `initDB(path)`: Initialize DB connection and run migrations.
- `saveMessage(chatId, role, content)`: Store message.
- `getRecentContext(chatId, limit)`: Retrieve last N messages formatted for context.

---

## Task 2: Dispatcher (Task Queue)

**Files:**
- Create: `src/dispatcher/index.ts`
- Test: `tests/dispatcher/dispatcher.test.ts`

**Requirements:**
- Singleton/Class managing a queue of tasks.
- `enqueue(task)`: Add task to queue.
- `processQueue()`: Run next task if not busy.
- Concurrency limit: 1 (configurable, but 1 for now).
- Task structure: `{ source: string, prompt: string, sessionId: string, ... }`

---

## Task 3: Telegram Bot Foundation

**Files:**
- Create: `src/telegram/bot.ts`
- Test: `tests/telegram/bot.test.ts` (Mocking Telegram API)

**Requirements:**
- Initialize `Bot` with token.
- Middleware: Auth check (compare `ctx.from.id` with config).
- Command handling: `/start`, `/help`, `/clear`.
- Text handling: Receive text -> Dispatch.

---

## Task 4: Integration - The "Loop"

**Files:**
- Modify: `src/telegram/bot.ts` (Connect to Dispatcher)
- Modify: `src/main.ts` (Initialize DB, Dispatcher, Bot)

**Flow:**
1. User sends message to Bot.
2. Bot saves User message to DB.
3. Bot enqueues task to Dispatcher.
4. Dispatcher picks up task.
5. Dispatcher invokes `claude -p` (using `src/claude/invoke.ts`).
   - *Crucial:* In Phase 2, we just pass the prompt.
   - *Context:* We need to fetch history from DB and prepend to prompt or use `--append-system-prompt`?
   - Decision: Prepend to prompt as "History:\nUser: ...\nAssistant: ..." or use a structured format if `claude -p` supports it. For now, simple text appending or `--append-system-prompt` context.
6. Claude executes and returns JSON.
7. Dispatcher/Callback saves Assistant response to DB.
8. Dispatcher/Callback sends response to Telegram.

---

## Task 5: Formatting & Polish

- Chunking long messages (>4096 chars).
- Markdown sanitization (Telegram uses a specific flavor of Markdown).
- Error handling (Telegram failure shouldn't crash the app).
