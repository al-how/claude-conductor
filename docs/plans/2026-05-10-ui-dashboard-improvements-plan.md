# UI Dashboard Improvements — 4 New Tabs

## Context

- Goal: add MCP status/configuration, queue/dispatcher status, session management, and chat settings to the web dashboard.
- Existing UI: single-file Alpine.js SPA (`public/index.html`) with 3 tabs (Cron Jobs, Settings, Skills), served statically via Fastify.
- Existing backend: SQLite DB with `claude_sessions`, `chat_settings`, `conversations` tables; Dispatcher with `isBusy()`/`getQueueLength()` but no current-task visibility; MCP config in `.claude.json` with no API exposure.
- Non-goals: real-time SSE/WebSocket, full API auth, conversation content viewer, webhook route UI, MCP server create/edit via dashboard.

## Tab Layout

Current: `Cron Jobs | Settings | Skills`

New (7 tabs):
```
Dashboard | Cron Jobs | Sessions | Chats | MCP | Settings | Skills
```

**Dashboard** becomes the default tab (`#dashboard`). It should feel like a useful home screen, not just a dispatcher debug view: queue status, active task, recent activity, and quick navigation into the detailed tabs. The other 6 tabs are detailed management views.

## Implementation Order (Rollout Sequence)

Read-only before mutation, to reduce risk:

| Phase | What Ships | Risk Level |
|-------|-----------|------------|
| 1 | Dispatcher changes + `/api/queue` + `/api/stats` + Dashboard tab (read-only) | Low |
| 2 | DB additions + `/api/sessions` + Sessions tab (read-only) | Low |
| 3 | `/api/mcp` GET + MCP tab (read-only list) | Low |
| 4 | `/api/chat-settings` GET + Chats tab (read-only list) | Low |
| 5 | `/api/mcp` PATCH/DELETE + MCP toggle/delete (mutations) | Medium |
| 6 | `/api/chat-settings` PATCH/DELETE + Chats edit/reset (mutations) | Medium |

Each phase ships and is verified before the next begins.

## Shared Infrastructure: Redaction Utility

**File: `src/server/redact.ts`** (new)

Centralized redaction for all prompt previews and MCP secrets. Used by queue, sessions, and MCP routes.

```typescript
const REDACT_ENV_PATTERNS = [
  /(api[_-]?key|token|secret|password|auth|credential)/i,
];

export function redactEnv(env: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).map(([k, v]) => [k, REDACT_ENV_PATTERNS.some(p => p.test(k)) ? '***' : v])
  );
}

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k, REDACT_ENV_PATTERNS.some(p => p.test(k)) ? '***' : v])
  );
}

export function redactPrompt(text: string, maxLength = 200): string {
  let out = text.substring(0, maxLength);
  out = out.replace(/(sk-[a-zA-Z0-9_-]+)/g, '[REDACTED]');
  out = out.replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]');
  out = out.replace(/AIza[0-9A-Za-z\-_]{35}/g, '[REDACTED]');
  return out;
}
```

Masking is always by **field name**, not value content. This covers `GOOGLE_MAPS_API_KEY`, `GEMINI_API_KEY`, `Authorization`, `N8N_API_KEY`, etc. — all the sensitive names where values won't contain the word "key".

**Trust boundary:** The dashboard is intended for a single user on a trusted local network. Redaction protects against accidental exposure (screenshot sharing, shoulder surfing), not a malicious authenticated attacker.

---

## Feature 1: Queue/Dispatcher Status → Dashboard Tab

### Backend: Dispatcher changes (`src/dispatcher/index.ts`)

Convert `processQueue` to store the active task on a class property instead of a local variable:

```typescript
export class Dispatcher {
  private currentTask: Task | undefined;
  // ...

  getCurrentTask(): { id: string; source: string; prompt: string } | undefined {
    if (!this.currentTask) return undefined;
    return {
      id: this.currentTask.id,
      source: this.currentTask.source,
      prompt: this.currentTask.prompt.substring(0, 200),
    };
  }

  getQueuedTasks(): { id: string; source: string; prompt: string }[] {
    return this.queue.map(t => ({
      id: t.id,
      source: t.source,
      prompt: t.prompt.substring(0, 200),
    }));
  }
}
```

In `processQueue`, set `this.currentTask = task` at the start of each iteration. Clear it in `finally` alongside `processing = false` — ensures it's never stale.

### Backend: API route (`src/server/queue-routes.ts`)

```
GET /api/queue → { busy, queueLength, currentTask, queuedTasks }
```

- `busy`: `dispatcher.isBusy()`
- `queueLength`: `dispatcher.getQueueLength()`
- `currentTask`: `dispatcher.getCurrentTask()` (null if idle). Prompt goes through `redactPrompt()`.
- `queuedTasks`: `dispatcher.getQueuedTasks()` (empty if none). Each prompt goes through `redactPrompt()`.

### Backend: Stats endpoint (`src/server/stats-routes.ts`)

```
GET /api/stats → { cronJobs: { total, enabled, disabled }, recentSessions: number, activeSession: string | null }
```

- `cronJobs`: queried from DB (`SELECT COUNT(*) FROM cron_jobs` and `SELECT COUNT(*) FROM cron_jobs WHERE enabled = 1`)
- `recentSessions`: count from `listRecentSessions({ limit: 20 }).length`
- `activeSession`: `dispatcher.isBusy() ? dispatcher.getCurrentTask()?.id : null`
- Optional enhancement: include `lastCompletedSession` summary if easy to derive without new persistence, so the Dashboard still feels informative when idle.

### Frontend: Dashboard section

- Two polling intervals: `/api/queue` every 5s, `/api/stats` every 30s.
- **Active Task card**: source badge (telegram/cron/webhook/voice), redacted prompt preview, task ID.
- **Queue card**: count, list of queued items with source badges.
- **Idle state**: "No active sessions" message.
- **Quick stats row**: total cron jobs (enabled/disabled counts), recent session count.
- **Recent Activity card**: show the most recent session preview/time if available, even when nothing is currently running.
- **Recent Sessions preview**: top 3-5 recent sessions with a "View all" affordance into the Sessions tab.
- **Quick links row**: jump actions for Cron Jobs, Sessions, Chats, and MCP.
- Stats endpoint is separate from queue endpoint because queue state changes rapidly and stats are relatively static.

The Dashboard should still be useful when the system is idle. A blank "No active sessions" state is not enough on its own.

---

## Feature 2: MCP Status & Configuration → MCP Tab

### Backend: Register export (`src/mcp/register.ts`)

Export server metadata — not just a name-to-section mapping, but a category per server:

```typescript
export const KNOWN_MCP_SERVERS: Record<string, { configSection: string; category: 'builtin' | 'toggleable' | 'view-only' }> = {
  'research': { configSection: 'builtin', category: 'builtin' },
  'google-workspace': { configSection: 'google_workspace', category: 'toggleable' },
  'n8n-mcp': { configSection: 'n8n', category: 'toggleable' },
  'google-maps': { configSection: 'google_maps', category: 'view-only' },
  'home-assistant': { configSection: 'home_assistant', category: 'view-only' },
};
```

Categories:
- `builtin`: always on, no toggle (research). Corresponds to no config section.
- `toggleable`: only needs `enabled: true` — all required fields have defaults (google_workspace, n8n).
- `view-only`: requires fields beyond `enabled` — `google_maps` needs `api_key`, `home_assistant` needs `url` + `token`. Cannot enable unless those fields are present in `config.yaml`.

### Backend: API route (`src/server/mcp-routes.ts`)

```
GET /api/mcp → { servers: McpServerInfo[] }
```

Reads `/home/claude/.claude.json`, extracts `mcpServers`, enriches each entry:

```typescript
interface McpServerInfo {
  name: string;
  type: 'stdio' | 'sse' | 'http';
  category: 'builtin' | 'toggleable' | 'view-only' | 'custom';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;  // all values redacted via redactEnv()
  headers?: Record<string, string>;  // all values redacted via redactHeaders()
  configSource: string;
  enabled: boolean;
  status?: 'enabled' | 'disabled' | 'misconfigured';
}
```

- Cross-reference with `KNOWN_MCP_SERVERS` to determine `category` and `configSource`. Unknown entries → `'custom'`.
- If `/home/claude/.claude.json` doesn't exist (running outside container), return empty array.

```
PATCH /api/mcp/:name → { success, enabled }
```

- Body: `{ enabled: boolean }`
- `builtin` (research): reject with 400.
- `view-only` (google-maps, home-assistant):
  - Disabling: always allowed (removes entry from `.claude.json`).
  - Enabling: verify the corresponding config section exists in `config.yaml` with all required fields. `google_maps` needs `api_key`. `home_assistant` needs `url` and `token`. If missing, return 400 with descriptive error.
- `toggleable` (google-workspace, n8n): update `config.yaml`'s corresponding `enabled` field via config writer, then call the appropriate `register*()` function to update `.claude.json` live.
- `custom`: directly add/remove entry in `.claude.json` via filesystem write.

```
DELETE /api/mcp/:name → { success }
```

- Only for `'custom'` servers. Remove entry from `.claude.json`.
- Known servers: reject with 400 (must toggle via config).

### Failure behavior for config writes

| Scenario | Status | Flash Message |
|----------|--------|---------------|
| Write succeeds | 200 | "Google Workspace MCP enabled" |
| Config writer throws | 500 | "Failed to update config.yaml: [error]" |
| Enabling view-only without required fields | 400 | "Cannot enable google-maps: google_maps.api_key is required" |
| `.claude.json` write fails after config.yaml succeeds | 500 | "Config updated but MCP registration failed. Restart to apply." |

No rollback of `config.yaml` if `.claude.json` fails — the config writer's CST approach writes the full document atomically, so partial writes are impossible.

### Frontend: MCP section (`#mcp` tab)

- Card list, richer than Skills — each card shows:
  - Server name (bold heading)
  - Category badge: `builtin` (gray), `toggleable` (blue), `view-only` (amber with tooltip), `custom` (green)
  - Status badge: `Enabled`, `Disabled`, or `Missing config`
  - Type badge (`stdio`/`sse`/`http`)
  - Command or URL (monospace, secondary text)
  - Config source label (e.g. "Google Workspace", "Built-in", "Custom")
  - Toggle switch — disabled for `builtin`, enabled for toggleable/custom, disabled with "Configure" link for view-only
  - Delete button (only for `custom`)
  - Expandable details showing args, env var names (all values shown as `***`)
- View-only servers show tooltip on hover: "This server requires additional configuration before it can be enabled."
- Do not present misconfigured known servers as ordinary toggles; the UI should make it obvious that setup is incomplete rather than implying the toggle is broken.
- Empty state: "No MCP servers configured."

---

## Feature 3: Session Management → Sessions Tab

### Backend: DB additions (`src/db/index.ts`)

```typescript
getAllSessionMappings(): Array<{ chat_id: number; session_id: string; updated_at: string }>
```

Query: `SELECT chat_id, session_id, updated_at FROM claude_sessions ORDER BY updated_at DESC`

### Backend: API route (`src/server/session-routes.ts`)

```
GET /api/sessions → { sessions: EnrichedSession[] }
```

1. Call `listRecentSessions({ vaultPath, limit: 20 })` to get filesystem session summaries.
2. Cross-reference with `db.getAllSessionMappings()` to find which chat_id owns each session UUID.
3. Apply `redactPrompt()` to each session `preview`.
4. Set `isCurrent: true` when the UUID matches the currently saved session mapping for that chat.
5. Return enriched entries:

```typescript
interface EnrichedSession {
  uuid: string;
  preview: string;     // redacted
  startedAt: string | null;
  relativeTime: string; // e.g. "5m ago"
  chatId: number | null; // null if no DB mapping (orphaned session)
  source?: 'telegram' | 'cron' | 'voice' | 'webhook';
  isCurrent?: boolean;
}
```

### Frontend: Sessions section (`#sessions` tab)

- Table: Preview | UUID | Chat ID | Time
- Preview: redacted (from API).
- UUID: first 8 chars shown, copy-to-clipboard button copies full `docker exec -it claude-conductor claude --resume <uuid>`.
- Chat ID: number if linked, "—" if orphaned.
- Time: relative (e.g. "5m ago", "2h ago").
- Source badge per row if available (`telegram` / `cron` / `voice` / `webhook`) for faster scanning.
- `Current` badge when this UUID is the session currently mapped to a chat.
- Click row to expand: full UUID, full preview, startedAt timestamp.
- Empty state: "No recent sessions."
- Copy-to-clipboard fallback: `navigator.clipboard` requires HTTPS/localhost; auto-select text in an `<input>` when clicked.

---

## Feature 4: Chat Settings → Chats Tab

### Backend: DB additions (`src/db/index.ts`)

```typescript
getAllChatSettings(): ChatSettings[]
```

Query: `SELECT * FROM chat_settings WHERE provider IS NOT NULL OR model IS NOT NULL ORDER BY updated_at DESC`

### Backend: API route (`src/server/chat-settings-routes.ts`)

```
GET /api/chat-settings → { chats: ChatSettings[] }
```

Returns all rows with non-null provider or model, ordered by `updated_at DESC`.

```
PATCH /api/chat-settings/:chatId → { success, chat: ChatSettings }
```

**Validation (server-side):**

1. If `provider` is present and not `null`: validate it's `'claude' | 'openrouter' | 'ollama'`. Reject unknown with 400.
2. If `provider` changes to a different value: clear `model` (same cross-provider logic as Telegram `/provider`).
3. If `model` is set with `openrouter` or `ollama` provider: call `resolveExecutionTarget({ provider, model, ollamaConfig, openRouterConfig })` to validate against `allowed_models` lists. If it throws, return 400 with the error message.
4. If `model` is set with `claude` provider: accept any string (aliases resolved at execution time).
5. If `model` is `null`: just clear the field, no validation needed.

Error responses:
```json
{ "error": "Unknown provider 'mistral'. Valid: claude, openrouter, ollama" }
{ "error": "Model 'gpt-4o' is not in the OpenRouter allowed_models list" }
{ "error": "OpenRouter provider requires openrouter config (api_key, allowed_models) in config.yaml" }
```

```
DELETE /api/chat-settings/:chatId → { success }
```

- Calls `db.clearChatSettings(chatId)`.
- Returns 404 if chat_id has no settings.

### Frontend: Chats section (`#chats` tab)

- Table: Chat ID | Session | Provider | Model | Updated | Actions
- `Session`: whether the chat currently has a saved Claude session mapping (`Active` / `None`)
- Provider shown as badge (`claude`/`openrouter`/`ollama`).
- Model displayed with existing `modelDisplay()` helper.
- Inline edit: provider dropdown (claude/openrouter/ollama/clear), model input with autocomplete from available models, save/cancel.
- Reset button clears all overrides for that chat.
- Empty state: "No per-chat overrides configured. Defaults apply to all chats."

The Chats tab should answer two questions at a glance:

1. Which chats have custom provider/model behavior?
2. Which chats still have an active resumable Claude session?

---

## Files Modified/Created

| File | Action | Notes |
|------|--------|-------|
| `src/server/redact.ts` | **Create** | Centralized redaction for prompts, env vars, headers |
| `src/dispatcher/index.ts` | Modify | Add `currentTask`, `getCurrentTask()`, `getQueuedTasks()` |
| `src/db/index.ts` | Modify | Add `getAllSessionMappings()`, `getAllChatSettings()`, `getCronJobStats()` |
| `src/mcp/register.ts` | Modify | Export `KNOWN_MCP_SERVERS` with categories (builtin/toggleable/view-only) |
| `src/server/queue-routes.ts` | **Create** | `GET /api/queue` |
| `src/server/stats-routes.ts` | **Create** | `GET /api/stats` |
| `src/server/mcp-routes.ts` | **Create** | `GET /api/mcp`, `PATCH /api/mcp/:name`, `DELETE /api/mcp/:name` |
| `src/server/session-routes.ts` | **Create** | `GET /api/sessions` |
| `src/server/chat-settings-routes.ts` | **Create** | `GET /api/chat-settings`, `PATCH /api/chat-settings/:chatId`, `DELETE /api/chat-settings/:chatId` |
| `src/server/index.ts` | Modify | Import + register 5 new route modules |
| `src/main.ts` | Modify | Pass `dispatcher`, `db`, `config` to new registrations |
| `public/index.html` | Modify | 4 new tabs, dual-interval polling, nav, richer dashboard states, all UI sections |

## Route Registration Wiring

In `src/main.ts`, after existing route registrations:

```typescript
registerQueueRoutes(app, dispatcher);
registerStatsRoutes(app, dispatcher, db);
registerMcpRoutes(app, config, logger);
registerSessionRoutes(app, db, config.vault_path);
registerChatSettingsRoutes(app, db, config.ollama, config.openrouter);
```

Each exports `register*Routes(app, ...)` matching `(FastifyInstance, ...) => void`.

## Frontend Data Model Additions

```javascript
// Data properties
dashboard: { busy: false, queueLength: 0, currentTask: null, queuedTasks: [] },
stats: { cronJobs: { total: 0, enabled: 0, disabled: 0 }, recentSessions: 0, activeSession: null },
mcpServers: [],
sessions: [],
chatSettings: [],
loadingStates: { dashboard: false, sessions: false, chats: false, mcp: false },
errorStates: { dashboard: '', sessions: '', chats: '', mcp: '' },
queueIntervalId: null,
statsIntervalId: null,

// Polling
startAutoRefresh() {
  this.queueIntervalId = setInterval(() => this.loadDashboard(), 5000);
  this.statsIntervalId = setInterval(() => this.loadStats(), 30000);
},
// Cleanup intervals on page hide (optional: use visibilitychange)
```

Add explicit per-tab states in the UI so the dashboard can distinguish:

- loading
- configured but empty
- not configured / unavailable
- request failed

Without this, the new tabs will feel brittle and ambiguous when an endpoint returns nothing.

## API Contracts — All New Endpoints

**`GET /api/queue`**
```json
{
  "busy": true,
  "queueLength": 2,
  "currentTask": { "id": "tg-123456789", "source": "telegram", "prompt": "Fix the login page..." },
  "queuedTasks": [
    { "id": "cron-news-1712345678000", "source": "cron", "prompt": "Check today's news..." }
  ]
}
```

**`GET /api/stats`**
```json
{
  "cronJobs": { "total": 5, "enabled": 3, "disabled": 2 },
  "recentSessions": 12,
  "activeSession": "tg-123456789"
}
```

**`GET /api/mcp`**
```json
{
  "servers": [
    {
      "name": "research",
      "type": "stdio",
      "category": "builtin",
      "command": "node",
      "args": ["/app/dist/mcp/server.js"],
      "env": { "GEMINI_API_KEY": "***", "OLLAMA_HOST": "http://localhost:11434" },
      "enabled": true
    },
    {
      "name": "google-maps",
      "type": "stdio",
      "category": "view-only",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-google-maps"],
      "env": { "GOOGLE_MAPS_API_KEY": "***" },
      "enabled": true,
      "enablable": true
    }
  ]
}
```

**`GET /api/sessions`**
```json
{
  "sessions": [
    {
      "uuid": "abc123-def456-ghi789",
      "preview": "Fix the Docker compose file for...",
      "startedAt": "2026-05-10T14:25:00.000Z",
      "relativeTime": "5m ago",
      "chatId": 123456789
    }
  ]
}
```

**`GET /api/chat-settings`**
```json
{
  "chats": [
    { "chat_id": 123456789, "provider": "openrouter", "model": "google/gemini-2.5-flash", "updated_at": "2026-05-10T12:00:00Z" }
  ]
}
```

## Test Matrix

| Test Area | What to Test | Test Type |
|-----------|-------------|-----------|
| **Dispatcher** | `getCurrentTask()` returns active task during `processQueue` | Unit |
| | `getCurrentTask()` returns `undefined` when idle | Unit |
| | `getQueuedTasks()` returns correct items when queue has entries | Unit |
| | `getQueuedTasks()` returns `[]` when queue is empty | Unit |
| | `currentTask` correctly set/cleared across multiple sequential tasks | Unit |
| **Redaction** | `redactEnv` masks `GOOGLE_MAPS_API_KEY`, `GEMINI_API_KEY`, `N8N_API_KEY`, `Authorization` | Unit |
| | `redactHeaders` masks `Authorization` header value | Unit |
| | `redactPrompt` masks inline `sk-*` keys and `Bearer` tokens | Unit |
| | Non-sensitive env vars pass through unchanged | Unit |
| **Queue API** | `GET /api/queue` returns idle state correctly | Route |
| | `GET /api/queue` returns busy + current task when active | Route |
| | Prompts are redacted in API response | Route |
| **Stats API** | `GET /api/stats` returns correct cron job counts | Route |
| | `GET /api/stats` returns `activeSession: null` when idle | Route |
| **MCP API** | `GET /api/mcp` returns empty when `.claude.json` missing | Route |
| | `GET /api/mcp` returns masked env/headers | Route |
| | `GET /api/mcp` shows correct `configSource` and `category` per server | Route |
| | `GET /api/mcp` shows `misconfigured` for known servers missing required config | Route |
| | `PATCH /api/mcp/research` rejected (builtin) | Route |
| | `PATCH /api/mcp/google-workspace` enabled/disabled | Route |
| | `PATCH /api/mcp/google-maps` enable rejected when missing api_key | Route |
| | `DELETE /api/mcp/custom-server` succeeds | Route |
| | `DELETE /api/mcp/google-workspace` rejected (not custom) | Route |
| **Session API** | `GET /api/sessions` returns empty when no vault path | Route |
| | `GET /api/sessions` returns enriched sessions with chat_id cross-reference | Route |
| | Orphaned sessions show `chatId: null` | Route |
| | Current mapped session is flagged with `isCurrent` | Route |
| | Previews are redacted | Route |
| **Chat Settings API** | `GET /api/chat-settings` returns non-null rows only | Route |
| | `PATCH /api/chat-settings/:id` validates provider enum | Route |
| | `PATCH` with openrouter model validates against allowed_models | Route |
| | `PATCH` changing provider clears model | Route |
| | `DELETE /api/chat-settings/:id` clears settings | Route |
| | `DELETE` on non-existent chat returns 404 | Route |
| **DB** | `getAllSessionMappings()` returns all mappings | Unit |
| | `getAllChatSettings()` excludes rows where both provider and model are null | Unit |
| **Frontend** | Dashboard default tab, idle state, and empty/error states render correctly | UI/Smoke |
| | Sessions and Chats tabs show badges/labels for current session state | UI/Smoke |

## Risks and Edge Cases

- **Dispatcher race**: `currentTask` must be cleared when queue empties, not when individual task completes. Set in `try` before `invokeClaude`, clear in `finally`.
- **MCP file missing**: `.claude.json` may not exist outside container — return empty array, don't crash.
- **MCP toggle persistence**: Config-controlled servers update `config.yaml` AND `mcpServers` in `.claude.json` in the same handler. Config writer uses YAML CST to preserve comments.
- **MCP view-only toggle**: Enabling requires verifying the full config block exists with required fields. The config object at runtime may have defaults baked in — checking `config.yaml` on disk is more reliable.
- **Session filesystem**: `listRecentSessions` reads `.jsonl` files. If vault path doesn't exist outside container, return empty gracefully.
- **Orphaned sessions**: `.jsonl` files with no matching DB `claude_sessions` entry. Show as "Unlinked" — useful for debugging.
- **Chat ID display**: Numeric Telegram IDs are opaque — no username resolution. Accept this for v1.
- **Dashboard polling**: Queue at 5s, stats at 30s. Lightweight GETs, no auth overhead. Fine for single-user dashboard.
- **Copy-to-clipboard**: `navigator.clipboard` requires HTTPS or localhost; provide fallback: auto-select text in an `<input>` when clicked.
- **Frontend polling cleanup**: `clearInterval` on `visibilitychange` or `beforeunload` to prevent stale requests after page navigation.
