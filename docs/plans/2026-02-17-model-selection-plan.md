# Model Selection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add configurable model selection to Claude Conductor with a layered resolution chain: per-task > per-source > global config > CLI default.

**Architecture:** A `resolveModel()` utility maps shorthand aliases (opus/sonnet/haiku) to full model IDs. The `--model` flag is added to CLI args when set. Each trigger source (Telegram, cron, webhook) resolves the model at task-creation time and passes it through to the invoke layer. Telegram gets a `/model` command for sticky and per-message overrides.

**Tech Stack:** TypeScript, Zod schemas, SQLite migrations, grammy bot commands

---

### Task 1: Model alias utility

**Files:**
- Create: `src/claude/models.ts`
- Create: `tests/claude/models.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/claude/models.test.ts
import { describe, it, expect } from 'vitest';
import { resolveModel, MODEL_ALIASES } from '../../src/claude/models.js';

describe('resolveModel', () => {
    it('should resolve "opus" to full model ID', () => {
        expect(resolveModel('opus')).toBe(MODEL_ALIASES.opus);
    });

    it('should resolve "sonnet" to full model ID', () => {
        expect(resolveModel('sonnet')).toBe(MODEL_ALIASES.sonnet);
    });

    it('should resolve "haiku" to full model ID', () => {
        expect(resolveModel('haiku')).toBe(MODEL_ALIASES.haiku);
    });

    it('should pass through full model IDs unchanged', () => {
        expect(resolveModel('claude-opus-4-5-20250514')).toBe('claude-opus-4-5-20250514');
    });

    it('should pass through unknown strings unchanged', () => {
        expect(resolveModel('some-custom-model')).toBe('some-custom-model');
    });

    it('should return undefined for undefined input', () => {
        expect(resolveModel(undefined)).toBeUndefined();
    });

    it('should be case-insensitive for aliases', () => {
        expect(resolveModel('Sonnet')).toBe(MODEL_ALIASES.sonnet);
        expect(resolveModel('OPUS')).toBe(MODEL_ALIASES.opus);
    });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/claude/models.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
// src/claude/models.ts
export const MODEL_ALIASES: Record<string, string> = {
    opus: 'claude-opus-4-5-20250514',
    sonnet: 'claude-sonnet-4-5-20250514',
    haiku: 'claude-haiku-3-5-20241022',
};

export function resolveModel(model: string | undefined): string | undefined {
    if (!model) return undefined;
    return MODEL_ALIASES[model.toLowerCase()] ?? model;
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/claude/models.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/claude/models.ts tests/claude/models.test.ts
git commit -m "feat: add model alias utility for shorthand model names"
```

---

### Task 2: Add --model flag to Claude invocation

**Files:**
- Modify: `src/claude/invoke.ts:6-21` (ClaudeInvokeOptions interface)
- Modify: `src/claude/invoke.ts:32-68` (buildClaudeArgs function)
- Modify: `tests/claude/invoke.test.ts`

**Step 1: Write the failing tests**

Add to `tests/claude/invoke.test.ts` inside the `describe('buildClaudeArgs', ...)` block:

```typescript
it('should include --model when provided', () => {
    const args = buildClaudeArgs({ prompt: 'hi', model: 'claude-sonnet-4-5-20250514' });
    expect(args).toContain('--model');
    const idx = args.indexOf('--model');
    expect(args[idx + 1]).toBe('claude-sonnet-4-5-20250514');
});

it('should not include --model when not provided', () => {
    const args = buildClaudeArgs({ prompt: 'hi' });
    expect(args).not.toContain('--model');
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/claude/invoke.test.ts`
Expected: FAIL — `--model` not in args

**Step 3: Implement the changes**

In `src/claude/invoke.ts`:

1. Add `model?: string;` to the `ClaudeInvokeOptions` interface (after line 18, before `timeout`).

2. In `buildClaudeArgs()`, destructure `model` from options (add to the destructuring block at line 33-45), and add this line before the `return args;` statement:

```typescript
if (model) args.push('--model', model);
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/claude/invoke.test.ts`
Expected: PASS (all existing + new tests)

**Step 5: Commit**

```bash
git add src/claude/invoke.ts tests/claude/invoke.test.ts
git commit -m "feat: add --model flag support to Claude Code invocation"
```

---

### Task 3: Add model field to config schemas

**Files:**
- Modify: `src/config/schema.ts:8-18` (CronJobSchema)
- Modify: `src/config/schema.ts:20-27` (WebhookRouteSchema)
- Modify: `src/config/schema.ts:45-52` (ConfigSchema)
- Modify: `tests/config/schema.test.ts`

**Step 1: Write the failing tests**

Add to `tests/config/schema.test.ts`:

```typescript
it('should accept global model field', () => {
    const result = ConfigSchema.safeParse({ model: 'sonnet' });
    expect(result.success).toBe(true);
    if (result.success) {
        expect(result.data.model).toBe('sonnet');
    }
});

it('should accept config without model field', () => {
    const result = ConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
        expect(result.data.model).toBeUndefined();
    }
});

it('should accept cron job with model field', () => {
    const result = CronJobSchema.safeParse({
        name: 'test', schedule: '0 7 * * *', prompt: 'do stuff', model: 'haiku'
    });
    expect(result.success).toBe(true);
    if (result.success) {
        expect(result.data.model).toBe('haiku');
    }
});

it('should accept webhook route with model field', () => {
    const result = ConfigSchema.safeParse({
        webhooks: [{
            name: 'gh',
            path: '/webhook/github-pr',
            prompt_template: 'Review: {{url}}',
            model: 'sonnet'
        }]
    });
    expect(result.success).toBe(true);
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/config/schema.test.ts`
Expected: FAIL — model field not recognized (Zod strips unknown keys by default, so the `model` value won't appear in output)

**Step 3: Implement the changes**

In `src/config/schema.ts`:

1. Add to `CronJobSchema` (after line 17, before the closing `}`):
```typescript
model: z.string().optional()
```

2. Add to `WebhookRouteSchema` (after line 26, before the closing `}`):
```typescript
model: z.string().optional()
```

3. Add to `ConfigSchema` (after line 46, before `telegram`):
```typescript
model: z.string().optional(),
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/config/schema.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/config/schema.ts tests/config/schema.test.ts
git commit -m "feat: add model field to config, cron job, and webhook schemas"
```

---

### Task 4: Add model column to cron_jobs database table

**Files:**
- Modify: `src/db/index.ts:102-109` (migrate method)
- Modify: `src/db/index.ts:172-178` (createCronJob method)
- Modify: `src/db/index.ts:190-213` (updateCronJob method)
- Modify: `src/db/index.ts:253-264` (CronJobRow interface)
- Modify: `tests/db/db.test.ts`

**Step 1: Write the failing tests**

Add to `tests/db/db.test.ts` (within the cron jobs describe block, or create one):

```typescript
it('should create a cron job with model field', () => {
    const job = db.createCronJob({
        name: 'model-test',
        schedule: '0 9 * * *',
        prompt: 'test',
        model: 'haiku'
    });
    expect(job.model).toBe('haiku');
});

it('should create a cron job with null model by default', () => {
    const job = db.createCronJob({
        name: 'no-model-test',
        schedule: '0 9 * * *',
        prompt: 'test'
    });
    expect(job.model).toBeNull();
});

it('should update a cron job model field', () => {
    db.createCronJob({ name: 'update-model-test', schedule: '0 9 * * *', prompt: 'test' });
    const updated = db.updateCronJob('update-model-test', { model: 'sonnet' });
    expect(updated?.model).toBe('sonnet');
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/db/db.test.ts`
Expected: FAIL — model property doesn't exist

**Step 3: Implement the changes**

1. Add `model: string | null;` to the `CronJobRow` interface (after `max_turns` at line 261).

2. In `migrate()` (around line 102-109), add after the existing `max_turns` migration:

```typescript
if (!cols.some(c => c.name === 'model')) {
    this.db.exec('ALTER TABLE cron_jobs ADD COLUMN model TEXT DEFAULT NULL');
    this.logger?.info('Migration: added model column to cron_jobs');
}
```

3. In `createCronJob()` (line 172), add `model` to the method signature, SQL, and parameters:
   - Add `model?: string | null` to the parameter object type
   - Update SQL to: `INSERT INTO cron_jobs (name, schedule, prompt, output, enabled, timezone, max_turns, model) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
   - Add `job.model ?? null` to the `stmt.run()` args

4. In `updateCronJob()` (line 190), add model handling alongside the other fields (after line 202):

```typescript
if (updates.model !== undefined) { fields.push('model = ?'); values.push(updates.model); }
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/db/db.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/db/index.ts tests/db/db.test.ts
git commit -m "feat: add model column to cron_jobs table with migration"
```

---

### Task 5: Pass model through cron scheduler

**Files:**
- Modify: `src/cron/scheduler.ts:180-254` (executeJob method)
- Modify: `tests/cron/scheduler.test.ts`

**Step 1: Write the failing test**

Check existing test patterns in `tests/cron/scheduler.test.ts` first. Add a test that verifies the model field is passed to the dispatcher when a cron job has a model set. The test should mock the dispatcher and verify the enqueued task includes `model`.

```typescript
it('should pass job model to dispatcher when set', async () => {
    // Create job with model
    db.createCronJob({ name: 'model-job', schedule: '0 9 * * *', prompt: 'test', model: 'haiku' });

    const enqueueSpy = vi.spyOn(dispatcher, 'enqueue');
    await scheduler.triggerJob('model-job');

    expect(enqueueSpy).toHaveBeenCalledWith(
        expect.objectContaining({ model: expect.any(String) })
    );
    // The model should be the resolved full ID
});
```

Adapt this to match the existing test setup patterns in the file.

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cron/scheduler.test.ts`
Expected: FAIL — model not in enqueued task

**Step 3: Implement the changes**

In `src/cron/scheduler.ts`:

1. Add import at the top:
```typescript
import { resolveModel } from '../claude/models.js';
```

2. In `executeJob()` at line 188, add `model` to the enqueued task object. The scheduler needs access to the global config model as a fallback. Add `globalModel?: string` to `CronSchedulerConfig` interface (line 9-15).

Update `CronSchedulerConfig`:
```typescript
export interface CronSchedulerConfig {
    dispatcher: Dispatcher;
    vaultPath: string;
    logger: Logger;
    db: DatabaseManager;
    sendTelegram?: (text: string) => Promise<void>;
    globalModel?: string;
}
```

In `executeJob()`, add model resolution and pass it to the task:
```typescript
// After line 186 (const enrichedPrompt = ...)
const model = resolveModel(job.model ?? this.config.globalModel ?? undefined);
```

Then add `model,` to the object passed to `this.config.dispatcher.enqueue({...})` (after `outputFormat` at line 197).

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cron/scheduler.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/cron/scheduler.ts tests/cron/scheduler.test.ts
git commit -m "feat: pass model from cron job config to dispatcher"
```

---

### Task 6: Pass model through cron API routes

**Files:**
- Modify: `src/server/cron-routes.ts:46-54` (create job)
- Modify: `tests/server/cron-routes.test.ts`

**Step 1: Write the failing test**

Add to `tests/server/cron-routes.test.ts`:

```typescript
it('should create a job with model field', async () => {
    const response = await app.inject({
        method: 'POST',
        url: '/api/cron',
        payload: {
            name: 'model-job',
            schedule: '0 9 * * *',
            prompt: 'test prompt',
            model: 'haiku'
        }
    });
    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.job.model).toBe('haiku');
});
```

Adapt to match the existing test patterns in the file.

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/cron-routes.test.ts`
Expected: FAIL — model field stripped by schema or not passed through

**Step 3: Implement the changes**

In `src/server/cron-routes.ts`:

The `CronJobCreateSchema` already extends `CronJobSchema` (line 7), so the `model` field from Task 3 is already available in the schema. Just add `model` to the `db.createCronJob()` call at line 46-54:

```typescript
const job = db.createCronJob({
    name: body.name,
    schedule: body.schedule,
    prompt: body.prompt,
    output: body.output,
    enabled: body.enabled ?? 1,
    timezone: body.timezone,
    max_turns: body.max_turns ?? null,
    model: body.model ?? null
});
```

The update route (`PATCH`) should already work since `CronJobUpdateSchema` is a partial of `CronJobCreateSchema`, and `updateCronJob` already handles dynamic field updates. Verify this with the test.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/cron-routes.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/server/cron-routes.ts tests/server/cron-routes.test.ts
git commit -m "feat: accept model field in cron job API endpoints"
```

---

### Task 7: Pass model through webhook handler (future-proofing)

**Note:** The webhook handler is not yet implemented — only the schema exists. This task adds the model resolution pattern to the schema documentation so that when the webhook handler is built (Phase 4), it follows the same pattern as the cron scheduler.

**Files:**
- Modify: `src/main.ts:101-122` (runtime rules)

**Step 1: Update the harness API rules**

In `src/main.ts`, update the runtime rules written to `/vault/.claude/rules/harness-api.md` to document the `model` field in the cron API:

Add to the "Create a scheduled task" example:
```
  -d '{"name": "task-name", "schedule": "0 9 * * *", "prompt": "...", "output": "telegram", "model": "sonnet"}'
```

Add a note:
```
Model options: opus, sonnet, haiku (shorthand), or full model IDs. Optional — defaults to global config model.
```

**Step 2: Commit**

```bash
git add src/main.ts
git commit -m "docs: document model field in harness API rules"
```

---

### Task 8: Add /model command to Telegram bot

**Files:**
- Modify: `src/telegram/bot.ts:10-17` (TelegramBotConfig interface)
- Modify: `src/telegram/bot.ts:21-28` (class properties)
- Modify: `src/telegram/bot.ts:73-91` (setupHandlers)
- Modify: `src/telegram/bot.ts:92-96` (message:text handler)
- Modify: `src/telegram/bot.ts:190-244` (enqueueClaudeTask)
- Modify: `tests/telegram/bot.test.ts`

**Step 1: Write the failing tests**

Check `tests/telegram/bot.test.ts` for existing patterns. Add tests for:

```typescript
// Test: /model with no args replies with current model
// Test: /model sonnet sets sticky model and replies with confirmation
// Test: /model default clears sticky model
// Test: /model reset clears sticky model
// Test: /model haiku <prompt> sends task with haiku model without changing sticky
// Test: regular message uses sticky model when set
// Test: regular message without sticky uses global model
```

Adapt to match the existing test harness and mocking patterns.

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/telegram/bot.test.ts`
Expected: FAIL

**Step 3: Implement the changes**

The `/model` command is split into two concerns:
- **State management** (`bot.command('model', ...)`) — handles query, sticky set, and reset
- **Per-message override** (`bot.on('message:text', ...)`) — detects `/model <alias> <prompt>` pattern

1. Add `globalModel?: string` to `TelegramBotConfig` interface.

2. Add class properties to `TelegramBot`:
```typescript
private stickyModel: string | undefined;
private globalModel: string | undefined;
```

3. In the constructor, set `this.globalModel = config.globalModel;`

4. Add import at the top of the file:
```typescript
import { resolveModel } from '../claude/models.js';
```

5. In `setupHandlers()`, add the `/model` command handler (state management only):

```typescript
this.bot.command('model', async (ctx) => {
    const text = ctx.message?.text || '';
    const args = text.replace(/^\/model\s*/, '').trim();

    if (!args) {
        // Query mode: show current model
        const current = this.stickyModel || this.globalModel || 'default (CLI default)';
        await ctx.reply(`Current model: ${current}`);
        return;
    }

    const modelArg = args.toLowerCase();

    if (modelArg === 'default' || modelArg === 'reset') {
        this.stickyModel = undefined;
        await ctx.reply('Model reset to default.');
        return;
    }

    // Sticky mode: /model sonnet
    this.stickyModel = modelArg;
    await ctx.reply(`Model set to: ${modelArg}`);
});
```

6. Update the `bot.on('message:text', ...)` handler to detect per-message model overrides:

```typescript
this.bot.on('message:text', async (ctx) => {
    const text = ctx.message.text;
    this.logger?.info({ event: 'message_received', userId: ctx.from.id, text }, 'Received message');

    // Check for per-message model override: "/model <alias> <prompt>"
    const modelOverrideMatch = text.match(/^\/model\s+(\S+)\s+(.+)/s);
    if (modelOverrideMatch) {
        const [, modelArg, prompt] = modelOverrideMatch;
        await this.handleUserMessage(ctx, prompt, undefined, modelArg.toLowerCase());
        return;
    }

    await this.handleUserMessage(ctx, text);
});
```

7. Update `handleUserMessage()` signature to accept an optional model override:

```typescript
private async handleUserMessage(ctx: Context, text: string, filePaths?: string[], modelOverride?: string)
```

Pass it through to `enqueueClaudeTask`:
```typescript
this.enqueueClaudeTask(ctx, prompt, ctx.message!.message_id, modelOverride);
```

8. Update `enqueueClaudeTask()` to accept and pass model:

```typescript
private enqueueClaudeTask(ctx: Context, prompt: string, messageId: number, model?: string)
```

Add `model` to the task object passed to `this.dispatcher!.enqueue({...})`:
```typescript
model: resolveModel(model || this.stickyModel || this.globalModel || undefined),
```

9. Update `/help` command to include `/model`:
```typescript
this.bot.command('help', (ctx) => ctx.reply('Commands: /start, /help, /clear, /model'));
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/telegram/bot.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/telegram/bot.ts tests/telegram/bot.test.ts
git commit -m "feat: add /model command to Telegram bot for model selection"
```

---

### Task 9: Wire global model through main.ts

**Files:**
- Modify: `src/main.ts:75-83` (CronScheduler initialization)
- Modify: `src/main.ts:61-68` (TelegramBot initialization)

**Step 1: Implement the changes**

In `src/main.ts`:

1. Pass `globalModel` to the `CronScheduler` config (around line 75-83):

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
});
```

2. Pass `globalModel` to the `TelegramBot` config (around line 61-68):

```typescript
bot = new TelegramBot({
    token: config.telegram.bot_token,
    allowedUsers: config.telegram.allowed_users,
    workingDir: config.vault_path,
    logger,
    db,
    dispatcher,
    globalModel: config.model,
});
```

**Step 2: Run full test suite**

Run: `npx vitest run`
Expected: PASS — all tests green

**Step 3: Type check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat: wire global model config through to scheduler and telegram bot"
```

---

### Task 10: Update config.example.yaml and CLAUDE.md

**Files:**
- Modify: `config.example.yaml`
- Modify: `CLAUDE.md`

**Step 1: Update config.example.yaml**

Add `model` field with a comment at the top level, after the existing content:

```yaml
# Model selection (optional)
# Shorthand: opus, sonnet, haiku — or use full model IDs
# model: sonnet
```

**Step 2: Update CLAUDE.md**

In the "Claude Code Invocation Patterns" section, add a note about the `--model` flag being passed when configured. In the "Claude Code CLI Session Flags" section, add:

```
- `--model` is passed when a model is configured (global, per-job, or per-message override)
- Shorthand aliases: opus, sonnet, haiku (mapped to full IDs in src/claude/models.ts)
```

**Step 3: Commit**

```bash
git add config.example.yaml CLAUDE.md
git commit -m "docs: document model selection configuration"
```

---

### Task 11: Final verification

**Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: All tests PASS

**Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Build**

Run: `npx tsc`
Expected: Clean build to `dist/`
