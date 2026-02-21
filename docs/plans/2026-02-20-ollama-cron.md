# Ollama Cron Job Integration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow cron jobs to run on local Ollama models via Claude Code's native Ollama support, with a grouped model picker in the dashboard and per-job allowedTools configuration.

**Architecture:** Add a provider concept to model resolution — `resolveModel()` returns a `ResolvedModel` object with provider info and env var overrides. The CLI invocation path injects Ollama-specific env vars when the provider is `ollama`. A new API endpoint discovers available Ollama models. The dashboard gets a grouped dropdown for model selection and exposes per-job allowedTools.

**Tech Stack:** TypeScript, Fastify, Alpine.js, SQLite, Claude Code CLI with Ollama env vars

**Design doc:** `docs/plans/2026-02-20-ollama-cron-design.md`

---

### Task 1: Config Schema — Add Ollama Config

**Files:**
- Modify: `src/config/schema.ts:42-62`
- Test: `tests/config/loader.test.ts`

**Step 1: Write the failing test**

In `tests/config/loader.test.ts`, add a test that validates ollama config parsing:

```typescript
it('should parse ollama config', () => {
    const yaml = `
vault_path: /vault
ollama:
  base_url: "http://192.168.1.100:11434"
`;
    writeFileSync(configPath, yaml);
    const config = loadConfig(configPath);
    expect(config.ollama).toEqual({ base_url: 'http://192.168.1.100:11434' });
});

it('should accept config without ollama section', () => {
    const yaml = `vault_path: /vault\n`;
    writeFileSync(configPath, yaml);
    const config = loadConfig(configPath);
    expect(config.ollama).toBeUndefined();
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/config/loader.test.ts`
Expected: FAIL — `ollama` not in schema, gets stripped by Zod

**Step 3: Add Ollama schema to config**

In `src/config/schema.ts`, add before the `ConfigSchema`:

```typescript
const OllamaConfigSchema = z.object({
    base_url: z.string().url()
});
```

Add to `ConfigSchema`:

```typescript
ollama: OllamaConfigSchema.optional(),
```

Export the type:

```typescript
export type OllamaConfig = z.infer<typeof OllamaConfigSchema>;
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/config/loader.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/config/schema.ts tests/config/loader.test.ts
git commit -m "feat: add ollama config schema"
```

---

### Task 2: Model Resolution — Return ResolvedModel Object

**Files:**
- Modify: `src/claude/models.ts`
- Create: `tests/claude/models.test.ts`

**Step 1: Write the failing tests**

Create `tests/claude/models.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { resolveModel } from '../../src/claude/models.js';

describe('resolveModel', () => {
    it('should return undefined for undefined input', () => {
        expect(resolveModel(undefined)).toBeUndefined();
    });

    it('should resolve Claude alias to full model ID', () => {
        const result = resolveModel('sonnet');
        expect(result).toEqual({
            model: 'claude-sonnet-4-6',
            provider: 'claude',
        });
    });

    it('should pass through unknown Claude model IDs', () => {
        const result = resolveModel('claude-opus-4-5-20250514');
        expect(result).toEqual({
            model: 'claude-opus-4-5-20250514',
            provider: 'claude',
        });
    });

    it('should resolve ollama: prefixed model', () => {
        const result = resolveModel('ollama:qwen3-coder');
        expect(result).toEqual({
            model: 'qwen3-coder',
            provider: 'ollama',
        });
    });

    it('should resolve ollama: prefix case-insensitively', () => {
        const result = resolveModel('Ollama:llama3');
        expect(result).toEqual({
            model: 'llama3',
            provider: 'ollama',
        });
    });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/claude/models.test.ts`
Expected: FAIL — `resolveModel` returns `string | undefined`, not `ResolvedModel`

**Step 3: Implement ResolvedModel**

Replace `src/claude/models.ts` content:

```typescript
export const MODEL_ALIASES: Record<string, string> = {
    'opus': 'claude-opus-4-6',
    'opus-4.6': 'claude-opus-4-6',
    'opus-4.5': 'claude-opus-4-5-20250514',
    'sonnet': 'claude-sonnet-4-6',
    'sonnet-4.6': 'claude-sonnet-4-6',
    'sonnet-4.5': 'claude-sonnet-4-5-20250514',
    'haiku': 'claude-haiku-4-5-20251001',
    'haiku-4.5': 'claude-haiku-4-5-20251001',
};

export interface ResolvedModel {
    model: string;
    provider: 'claude' | 'ollama';
}

const OLLAMA_PREFIX = 'ollama:';

export function resolveModel(model: string | undefined): ResolvedModel | undefined {
    if (!model) return undefined;

    // Check for ollama: prefix
    if (model.toLowerCase().startsWith(OLLAMA_PREFIX)) {
        return {
            model: model.slice(OLLAMA_PREFIX.length),
            provider: 'ollama',
        };
    }

    // Claude alias or pass-through
    return {
        model: MODEL_ALIASES[model.toLowerCase()] ?? model,
        provider: 'claude',
    };
}

export function isKnownAlias(model: string): boolean {
    return model.toLowerCase() in MODEL_ALIASES;
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/claude/models.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/claude/models.ts tests/claude/models.test.ts
git commit -m "feat: resolveModel returns ResolvedModel with provider info"
```

---

### Task 3: Update All resolveModel Callers

**Files:**
- Modify: `src/cron/scheduler.ts:9,208,276`
- Modify: `src/telegram/bot.ts` (find `resolveModel` usage)
- Modify: `src/claude/invoke.ts:18` (add `env` to options)
- Modify: `src/dispatcher/index.ts:4` (add `env` to Task)

This task has no new tests — it's a refactor to adapt callers to the new `ResolvedModel` return type. Existing tests should still pass after changes.

**Step 1: Update `ClaudeInvokeOptions` in `invoke.ts`**

Add `providerEnv` field to the `ClaudeInvokeOptions` interface at `src/claude/invoke.ts:6-22`:

```typescript
export interface ClaudeInvokeOptions {
    prompt: string;
    workingDir?: string;
    sessionId?: string;
    resume?: boolean;
    continue?: boolean;
    forkSession?: boolean;
    allowedTools?: string[];
    dangerouslySkipPermissions?: boolean;
    noSessionPersistence?: boolean;
    maxTurns?: number;
    outputFormat?: 'text' | 'json' | 'stream-json';
    model?: string;
    appendSystemPrompt?: string;
    timeout?: number;
    logger?: Logger;
    providerEnv?: Record<string, string>;
}
```

**Step 2: Update `invokeClaude` to merge providerEnv**

In `src/claude/invoke.ts:126-133`, change the env setup:

Replace:
```typescript
        // Strip ANTHROPIC_API_KEY so CLI sessions authenticate via OAuth
        // (API key is only needed by Agent SDK in invoke-api.ts)
        const { ANTHROPIC_API_KEY, ...cleanEnv } = process.env;
        const child = spawn('claude', args, {
            cwd: workingDir,
            env: cleanEnv,
            stdio: ['ignore', 'pipe', 'pipe']
        });
```

With:
```typescript
        // Strip ANTHROPIC_API_KEY so CLI sessions authenticate via OAuth
        // (API key is only needed by Agent SDK in invoke-api.ts)
        const { ANTHROPIC_API_KEY, ...cleanEnv } = process.env;
        // Merge provider-specific env vars (e.g. Ollama overrides)
        const childEnv = options.providerEnv
            ? { ...cleanEnv, ...options.providerEnv }
            : cleanEnv;
        const child = spawn('claude', args, {
            cwd: workingDir,
            env: childEnv,
            stdio: ['ignore', 'pipe', 'pipe']
        });
```

**Step 3: Update scheduler `executeJobCli` at `src/cron/scheduler.ts:269-331`**

Replace lines 276-288:
```typescript
        const model = resolveModel(job.model ?? this.config.globalModel ?? undefined);

        this.config.dispatcher.enqueue({
            id: `cron-${job.name}-${Date.now()}`,
            source: 'cron',
            prompt: enrichedPrompt,
            workingDir: this.config.vaultPath,
            logger: this.logger,
            noSessionPersistence: true,
            allowedTools: ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
            maxTurns: job.max_turns || undefined,
            model,
            outputFormat: 'stream-json',
```

With:
```typescript
        const resolved = resolveModel(job.model ?? this.config.globalModel ?? undefined);

        this.config.dispatcher.enqueue({
            id: `cron-${job.name}-${Date.now()}`,
            source: 'cron',
            prompt: enrichedPrompt,
            workingDir: this.config.vaultPath,
            logger: this.logger,
            noSessionPersistence: true,
            allowedTools: ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
            maxTurns: job.max_turns || undefined,
            model: resolved?.model,
            providerEnv: resolved?.provider === 'ollama' ? this.getOllamaEnv() : undefined,
            outputFormat: 'stream-json',
```

**Step 4: Add `getOllamaEnv()` helper to scheduler and update config interface**

Add to `CronSchedulerConfig` interface:
```typescript
    ollamaBaseUrl?: string;
```

Add method to `CronScheduler` class:
```typescript
    private getOllamaEnv(): Record<string, string> {
        return {
            ANTHROPIC_BASE_URL: this.config.ollamaBaseUrl || 'http://localhost:11434',
            ANTHROPIC_AUTH_TOKEN: 'ollama',
            ANTHROPIC_API_KEY: '',
        };
    }
```

**Step 5: Update scheduler `executeJobApi` model resolution at `src/cron/scheduler.ts:208`**

Replace:
```typescript
        const model = resolveModel(job.model ?? this.config.apiConfig.defaultModel ?? this.config.globalModel ?? undefined);
```
With:
```typescript
        const resolved = resolveModel(job.model ?? this.config.apiConfig.defaultModel ?? this.config.globalModel ?? undefined);
        const model = resolved?.model;
```

Note: API mode does not support Ollama — it uses the Anthropic SDK directly. If someone sets an `ollama:` model on an API-mode job, the model string will be wrong, but that's a validation concern handled in Task 7.

**Step 6: Update `main.ts` to pass ollamaBaseUrl to scheduler**

In `src/main.ts:79-90`, add `ollamaBaseUrl`:

```typescript
    const scheduler = new CronScheduler({
        dispatcher,
        vaultPath: config.vault_path,
        logger,
        db: db!,
        sendTelegram: bot
            ? (text) => bot!.sendMessage(config.telegram!.allowed_users[0], text)
            : undefined,
        globalModel: config.model,
        apiConfig: config.api ? { anthropicApiKey: config.api.anthropic_api_key, defaultModel: config.api.default_model } : undefined,
        chatId: config.telegram?.allowed_users[0],
        ollamaBaseUrl: config.ollama?.base_url,
    });
```

**Step 7: Update Telegram bot's `resolveModel` usage**

Read `src/telegram/bot.ts`, find `resolveModel` calls, and update to extract `.model` from the result. The Telegram bot doesn't support Ollama (per design scope), so just extract the model string:

Replace pattern:
```typescript
const model = resolveModel(...);
```
With:
```typescript
const model = resolveModel(...)?.model;
```

**Step 8: Run all tests**

Run: `npx vitest run`
Expected: All existing tests PASS (the return type change is compatible since callers are all updated)

**Step 9: Run type-check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 10: Commit**

```bash
git add src/claude/invoke.ts src/cron/scheduler.ts src/dispatcher/index.ts src/telegram/bot.ts src/main.ts
git commit -m "refactor: update callers for ResolvedModel return type and providerEnv"
```

---

### Task 4: Ollama Model Discovery API Route

**Files:**
- Modify: `src/server/cron-routes.ts`
- Create: `tests/server/ollama-routes.test.ts`

**Step 1: Write the failing test**

Create `tests/server/ollama-routes.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fastify, type FastifyInstance } from 'fastify';
import { registerCronRoutes } from '../../src/server/cron-routes.js';

// We'll test the /api/ollama/models route
describe('GET /api/ollama/models', () => {
    let app: FastifyInstance;

    beforeEach(async () => {
        app = fastify();
    });

    it('should return available: false when ollama is not configured', async () => {
        // Register with no ollamaBaseUrl
        registerCronRoutes(app, {} as any, {} as any, false);
        await app.ready();
        const res = await app.inject({ method: 'GET', url: '/api/ollama/models' });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ models: [], available: false });
    });

    it('should return models from ollama when configured', async () => {
        // Mock global fetch
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                models: [
                    { name: 'qwen3-coder:latest', size: 4000000000, modified_at: '2026-01-01T00:00:00Z' },
                    { name: 'llama3:latest', size: 8000000000, modified_at: '2026-01-15T00:00:00Z' },
                ]
            })
        });
        vi.stubGlobal('fetch', mockFetch);

        registerCronRoutes(app, {} as any, {} as any, false, 'http://192.168.1.100:11434');
        await app.ready();
        const res = await app.inject({ method: 'GET', url: '/api/ollama/models' });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.available).toBe(true);
        expect(body.models).toHaveLength(2);
        expect(body.models[0].name).toBe('qwen3-coder:latest');

        vi.unstubAllGlobals();
    });

    it('should return available: false when ollama is unreachable', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

        registerCronRoutes(app, {} as any, {} as any, false, 'http://192.168.1.100:11434');
        await app.ready();
        const res = await app.inject({ method: 'GET', url: '/api/ollama/models' });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ models: [], available: false });

        vi.unstubAllGlobals();
    });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/ollama-routes.test.ts`
Expected: FAIL — route doesn't exist, `registerCronRoutes` doesn't accept `ollamaBaseUrl` param

**Step 3: Add ollamaBaseUrl parameter and route to `cron-routes.ts`**

Update the function signature at `src/server/cron-routes.ts:14`:

```typescript
export function registerCronRoutes(app: FastifyInstance, db: DatabaseManager, scheduler: CronScheduler, apiEnabled: boolean = false, ollamaBaseUrl?: string) {
```

Add the route at the end of the function (before the closing `}`):

```typescript
    // Ollama model discovery
    app.get('/api/ollama/models', async () => {
        if (!ollamaBaseUrl) {
            return { models: [], available: false };
        }
        try {
            const res = await fetch(`${ollamaBaseUrl}/api/tags`);
            if (!res.ok) return { models: [], available: false };
            const data = await res.json() as { models: Array<{ name: string; size: number; modified_at: string }> };
            return {
                models: data.models.map(m => ({ name: m.name, size: m.size, modified_at: m.modified_at })),
                available: true,
            };
        } catch {
            return { models: [], available: false };
        }
    });
```

**Step 4: Update `main.ts` to pass `ollamaBaseUrl` to `registerCronRoutes`**

At `src/main.ts:105`:

Replace:
```typescript
    registerCronRoutes(app, db!, scheduler, !!config.api);
```
With:
```typescript
    registerCronRoutes(app, db!, scheduler, !!config.api, config.ollama?.base_url);
```

**Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/server/ollama-routes.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/server/cron-routes.ts src/main.ts tests/server/ollama-routes.test.ts
git commit -m "feat: add /api/ollama/models discovery endpoint"
```

---

### Task 5: Database Migration — Add allowed_tools Column

**Files:**
- Modify: `src/db/index.ts:102-124` (migrate method)
- Modify: `src/db/index.ts:271-284` (CronJobRow interface)

**Step 1: Add column to migration**

In `src/db/index.ts`, in the `migrate()` method after the `execution_mode` migration (line 116), add:

```typescript
        if (!cols.some(c => c.name === 'allowed_tools')) {
            this.db.exec('ALTER TABLE cron_jobs ADD COLUMN allowed_tools TEXT DEFAULT NULL');
            this.logger?.info('Migration: added allowed_tools column to cron_jobs');
        }
```

**Step 2: Update CronJobRow interface**

Add to the `CronJobRow` interface at `src/db/index.ts:271-284`:

```typescript
    allowed_tools: string | null;
```

**Step 3: Update createCronJob method**

At `src/db/index.ts:187-193`, update to include `allowed_tools`:

```typescript
    public createCronJob(job: { name: string; schedule: string; prompt: string; output?: string; enabled?: number; timezone?: string; max_turns?: number | null; model?: string | null; execution_mode?: string; allowed_tools?: string | null }): CronJobRow {
        const stmt = this.db.prepare(
            'INSERT INTO cron_jobs (name, schedule, prompt, output, enabled, timezone, max_turns, model, execution_mode, allowed_tools) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        stmt.run(job.name, job.schedule, job.prompt, job.output || 'telegram', job.enabled ?? 1, job.timezone || 'America/Chicago', job.max_turns ?? null, job.model ?? null, job.execution_mode ?? 'cli', job.allowed_tools ?? null);
        return this.getCronJob(job.name)!;
    }
```

**Step 4: Update updateCronJob method**

In `src/db/index.ts:205-230`, add after the `execution_mode` check:

```typescript
        if (updates.allowed_tools !== undefined) { fields.push('allowed_tools = ?'); values.push(updates.allowed_tools); }
```

**Step 5: Run type-check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 6: Commit**

```bash
git add src/db/index.ts
git commit -m "feat: add allowed_tools column to cron_jobs"
```

---

### Task 6: Cron Routes — Accept allowed_tools and Expose Claude Model List

**Files:**
- Modify: `src/server/cron-routes.ts`
- Modify: `src/config/schema.ts`

**Step 1: Add allowed_tools to CronJobSchema**

In `src/config/schema.ts`, add to `CronJobSchema`:

```typescript
    allowed_tools: z.string().optional(),
```

**Step 2: Update cron-routes to handle allowed_tools**

In `src/server/cron-routes.ts`, in the `POST /api/cron` handler, add to the `createCronJob` call:

```typescript
            allowed_tools: body.allowed_tools ?? null,
```

In the `PATCH` handler, `CronJobUpdateSchema` already inherits from `CronJobCreateSchema.partial()`, so `allowed_tools` is automatically accepted.

**Step 3: Add GET /api/models endpoint**

Add a route that returns the known Claude model aliases (for the grouped dropdown). Add this inside `registerCronRoutes`:

```typescript
    // Available model list for the dashboard picker
    app.get('/api/models', async () => {
        const claude = Object.keys(MODEL_ALIASES)
            .filter(k => !k.includes('.'))  // only short names: opus, sonnet, haiku
            .map(k => ({ alias: k, model: MODEL_ALIASES[k] }));
        return { claude };
    });
```

Import `MODEL_ALIASES` at the top of `cron-routes.ts`:

```typescript
import { MODEL_ALIASES } from '../claude/models.js';
```

**Step 4: Update scheduler to use per-job allowed_tools**

In `src/cron/scheduler.ts`, in `executeJobCli()`, replace the hardcoded allowedTools:

Replace:
```typescript
            allowedTools: ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
```
With:
```typescript
            allowedTools: job.allowed_tools ? job.allowed_tools.split(',').map(t => t.trim()) : ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
```

Do the same in `executeJobApi()`.

**Step 5: Run all tests**

Run: `npx vitest run`
Expected: PASS

**Step 6: Commit**

```bash
git add src/config/schema.ts src/server/cron-routes.ts src/cron/scheduler.ts
git commit -m "feat: per-job allowedTools and /api/models endpoint"
```

---

### Task 7: Dashboard — Grouped Model Picker

**Files:**
- Modify: `public/index.html`

This is a UI-only task. Changes to the Alpine.js app:

**Step 1: Add state for model lists**

In the `app()` return object, add:

```javascript
        // Model picker
        claudeModels: [],
        ollamaModels: [],
        ollamaAvailable: false,
```

**Step 2: Add model loading function**

```javascript
        async loadModels() {
            try {
                const [claudeRes, ollamaRes] = await Promise.all([
                    fetch('/api/models'),
                    fetch('/api/ollama/models'),
                ]);
                const claudeData = await claudeRes.json();
                this.claudeModels = claudeData.claude || [];
                const ollamaData = await ollamaRes.json();
                this.ollamaModels = ollamaData.models || [];
                this.ollamaAvailable = ollamaData.available || false;
            } catch (e) {
                console.error('Failed to load models', e);
            }
        },
```

**Step 3: Call loadModels in init()**

```javascript
        async init() {
            this.tab = location.hash.replace('#', '') || 'cron';
            window.addEventListener('hashchange', () => {
                this.tab = location.hash.replace('#', '') || 'cron';
            });
            await Promise.all([this.loadJobs(), this.loadSettings(), this.loadSkills(), this.loadModels()]);
        },
```

**Step 4: Add helper to format model display**

```javascript
        modelDisplay(model) {
            if (!model) return '—';
            if (model.startsWith('ollama:')) return model.slice(7) + ' (ollama)';
            return model;
        },
```

**Step 5: Replace the model `<input>` in the create form (line 89-92)**

Replace:
```html
            <label>
              Model
              <input type="text" x-model="newJob.model" placeholder="(default)">
            </label>
```

With:
```html
            <label>
              Model
              <select x-model="newJob.model">
                <option value="">(default)</option>
                <optgroup label="Claude">
                  <template x-for="m in claudeModels" :key="m.alias">
                    <option :value="m.alias" x-text="m.alias"></option>
                  </template>
                </optgroup>
                <template x-if="ollamaAvailable">
                  <optgroup label="Ollama">
                    <template x-for="m in ollamaModels" :key="m.name">
                      <option :value="'ollama:' + m.name" x-text="m.name"></option>
                    </template>
                  </optgroup>
                </template>
                <option value="__custom__">Custom...</option>
              </select>
              <input x-show="newJob.model === '__custom__'" type="text" x-model="newJob.customModel" placeholder="model ID" style="margin-top:0.25rem">
            </label>
```

Add `customModel: ''` to the `newJob` initial state.

**Step 6: Update createJob() to handle custom model**

In `createJob()`, before sending:

```javascript
          if (body.model === '__custom__') body.model = this.newJob.customModel || undefined;
```

**Step 7: Do the same for the edit form model field (line 190-193)**

Replace the edit form model `<input>` with the same grouped `<select>` pattern, using `editForm.model` and `editForm.customModel`.

**Step 8: Update model display in the jobs table (line 154)**

Replace:
```html
                <td x-text="job.model || '—'"></td>
```
With:
```html
                <td x-text="modelDisplay(job.model)"></td>
```

**Step 9: Add allowed_tools field to create and edit forms**

After the Max Turns field in the create form, add:

```html
            <label class="full-width">
              Allowed Tools
              <input type="text" x-model="newJob.allowed_tools" placeholder="Read,Glob,Grep,WebSearch,WebFetch (default)">
              <small>Comma-separated tool names. Leave blank for defaults.</small>
            </label>
```

Add `allowed_tools: ''` to the `newJob` initial state.

Do the same for the edit form, binding to `editForm.allowed_tools`.

Update `startEdit()` to copy `allowed_tools`:
```javascript
            allowed_tools: job.allowed_tools || '',
```

Update `createJob()` and `saveEdit()` to include `allowed_tools`:
```javascript
          if (!body.allowed_tools) delete body.allowed_tools;
```

**Step 10: Manually verify in browser**

Open the dashboard, verify:
- Model dropdown shows Claude group with opus/sonnet/haiku
- If Ollama is configured and reachable, Ollama group appears with available models
- "Custom..." reveals a text input
- Existing jobs display model with provider indicator
- allowed_tools field appears in create/edit forms

**Step 11: Commit**

```bash
git add public/index.html
git commit -m "feat: grouped model picker and allowedTools in dashboard"
```

---

### Task 8: Settings Route — Expose Ollama Status

**Files:**
- Modify: `src/server/settings-routes.ts`

**Step 1: Add ollama_enabled to settings response**

In `src/server/settings-routes.ts`, update `registerSettingsRoutes` to accept the full config. Add `ollama_enabled` and `ollama_base_url` to the GET response:

```typescript
            ollama_enabled: !!config.ollama,
            ollama_base_url: config.ollama?.base_url ?? null,
```

**Step 2: Update dashboard settings tab**

In `public/index.html`, in the Settings readonly fields section, add after the Browser field:

```html
            <label>
              Ollama
              <input type="text" :value="settings.ollama_enabled ? settings.ollama_base_url : 'Disabled'" disabled>
              <small>Configure in config.yaml</small>
            </label>
```

**Step 3: Commit**

```bash
git add src/server/settings-routes.ts public/index.html
git commit -m "feat: show ollama status in settings dashboard"
```

---

### Task 9: Update CLAUDE.md and Rules File

**Files:**
- Modify: `CLAUDE.md`
- Modify: `src/main.ts` (rules file content)

**Step 1: Update CLAUDE.md**

Add to the "Claude Code Invocation Patterns" section:

```markdown
# Cron with Ollama (local model)
ANTHROPIC_BASE_URL=http://host:11434 ANTHROPIC_AUTH_TOKEN=ollama ANTHROPIC_API_KEY="" \
claude -p --model qwen3-coder --no-session-persistence --allowedTools "Read,Glob,Grep" --output-format stream-json
```

Add to the "Model resolution chain" note:

```markdown
- Models prefixed with `ollama:` (e.g., `ollama:qwen3-coder`) route to Ollama via env var injection on the CLI subprocess
- Ollama config: `ollama.base_url` in config.yaml
```

**Step 2: Update the runtime rules file in `main.ts`**

In the harness-api.md rules content, add Ollama model info:

```markdown
Model options: opus, sonnet, haiku (Claude shorthand), ollama:<model-name> (local Ollama), or full model IDs. Optional — defaults to global config model.
```

**Step 3: Commit**

```bash
git add CLAUDE.md src/main.ts
git commit -m "docs: update CLAUDE.md and rules for Ollama model support"
```

---

### Task 10: Version Bump and Final Verification

**Files:**
- Modify: `package.json`

**Step 1: Bump version**

Read current version from `package.json` and bump the minor version.

**Step 2: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

**Step 3: Run type-check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add package.json
git commit -m "chore: bump version for ollama integration"
```
