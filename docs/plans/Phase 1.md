# Phase 1: Foundation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the foundation layer for Claude Conductor — project scaffolding, config loading, logging, Claude Code invocation wrapper, health check endpoint, Dockerfile, and entry point.

**Architecture:** Single Node.js process (the harness) that loads config, starts an HTTP server with a health endpoint, and provides a wrapper to spawn `claude -p` as child processes. All components are modular and independently testable.

**Tech Stack:** TypeScript, Node.js 20, Vitest, Zod, Pino, Fastify, Docker

**Spec:** `docs/Claude Conductor.md`

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `vitest.config.ts`

**Step 1: Create package.json**

```json
{
  "name": "claude-conductor",
  "version": "0.1.0",
  "description": "Docker container wrapping Claude Code CLI with scheduling, messaging, and webhook capabilities",
  "type": "module",
  "main": "dist/main.js",
  "scripts": {
    "dev": "tsx src/main.ts",
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "engines": {
    "node": ">=20.0.0"
  },
  "dependencies": {
    "@fastify/cors": "^10.0.1",
    "fastify": "^5.2.0",
    "pino": "^9.6.0",
    "pino-pretty": "^13.0.0",
    "yaml": "^2.6.1",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/node": "^22.10.2",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "lib": ["ES2022"],
    "moduleResolution": "bundler",
    "rootDir": "./src",
    "outDir": "./dist",
    "declaration": true,
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

**Step 3: Create .gitignore**

```
node_modules/
dist/
coverage/
.env
.env.local
*.log
*.db
*.sqlite
config.local.yaml
```

**Step 4: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts']
  }
});
```

**Step 5: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, `package-lock.json` generated

**Step 6: Verify setup**

Run: `npm test`
Expected: vitest runs, 0 tests found, exits clean

**Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore
git commit -m "chore: initialize project scaffolding with TypeScript, vitest, fastify, pino, zod"
```

---

## Task 2: Config Schema

**Files:**
- Create: `src/config/schema.ts`
- Test: `tests/config/schema.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/config/schema.test.ts
import { describe, it, expect } from 'vitest';
import { ConfigSchema } from '../../src/config/schema.js';

describe('ConfigSchema', () => {
  it('should accept minimal valid config with just telegram', () => {
    const result = ConfigSchema.safeParse({
      telegram: {
        bot_token: 'test-token',
        allowed_users: [123]
      }
    });
    expect(result.success).toBe(true);
  });

  it('should accept empty config with defaults', () => {
    const result = ConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cron).toEqual([]);
      expect(result.data.webhooks).toEqual([]);
      expect(result.data.queue.max_concurrent).toBe(1);
      expect(result.data.browser.enabled).toBe(false);
    }
  });

  it('should reject telegram with empty bot_token', () => {
    const result = ConfigSchema.safeParse({
      telegram: { bot_token: '', allowed_users: [123] }
    });
    expect(result.success).toBe(false);
  });

  it('should reject telegram with empty allowed_users', () => {
    const result = ConfigSchema.safeParse({
      telegram: { bot_token: 'token', allowed_users: [] }
    });
    expect(result.success).toBe(false);
  });

  it('should validate cron job schema', () => {
    const result = ConfigSchema.safeParse({
      cron: [{ name: 'test', schedule: '0 7 * * *', prompt: 'do stuff' }]
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cron[0].output).toBe('log'); // default
    }
  });

  it('should validate webhook route schema', () => {
    const result = ConfigSchema.safeParse({
      webhooks: [{
        name: 'gh',
        path: '/webhook/github-pr',
        prompt_template: 'Review: {{url}}'
      }]
    });
    expect(result.success).toBe(true);
  });

  it('should reject webhook with invalid path', () => {
    const result = ConfigSchema.safeParse({
      webhooks: [{
        name: 'bad',
        path: '/not-a-webhook',
        prompt_template: 'test'
      }]
    });
    expect(result.success).toBe(false);
  });

  it('should apply queue defaults', () => {
    const result = ConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.queue.timeout_seconds).toBe(300);
      expect(result.data.queue.priority.telegram).toBe(1);
      expect(result.data.queue.priority.cron).toBe(2);
      expect(result.data.queue.priority.webhook).toBe(3);
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/config/schema.test.ts`
Expected: FAIL — cannot find module `../../src/config/schema.js`

**Step 3: Write the implementation**

```typescript
// src/config/schema.ts
import { z } from 'zod';

const TelegramConfigSchema = z.object({
  bot_token: z.string().min(1, 'Telegram bot token is required'),
  allowed_users: z.array(z.number().int().positive()).min(1, 'At least one allowed user required')
});

const CronJobSchema = z.object({
  name: z.string().min(1),
  schedule: z.string().min(1),
  prompt: z.string().min(1),
  output: z.enum(['telegram', 'log', 'webhook', 'silent']).default('log')
});

const WebhookRouteSchema = z.object({
  name: z.string().min(1),
  path: z.string().regex(/^\/webhook\/[a-z0-9-]+$/i, 'Webhook path must match /webhook/:name'),
  auth: z.enum(['bearer', 'none']).default('bearer'),
  secret: z.string().optional(),
  prompt_template: z.string().min(1),
  output: z.enum(['telegram', 'log', 'webhook', 'silent']).default('log')
});

const QueueConfigSchema = z.object({
  max_concurrent: z.number().int().min(1).max(10).default(1),
  timeout_seconds: z.number().int().min(30).max(3600).default(300),
  priority: z.object({
    telegram: z.number().int().min(1).max(10).default(1),
    cron: z.number().int().min(1).max(10).default(2),
    webhook: z.number().int().min(1).max(10).default(3)
  }).default({})
}).default({});

const BrowserConfigSchema = z.object({
  enabled: z.boolean().default(false),
  headless: z.boolean().default(true),
  vnc: z.boolean().default(false)
}).default({});

export const ConfigSchema = z.object({
  telegram: TelegramConfigSchema.optional(),
  cron: z.array(CronJobSchema).default([]),
  webhooks: z.array(WebhookRouteSchema).default([]),
  queue: QueueConfigSchema,
  browser: BrowserConfigSchema
});

export type Config = z.infer<typeof ConfigSchema>;
export type TelegramConfig = z.infer<typeof TelegramConfigSchema>;
export type CronJob = z.infer<typeof CronJobSchema>;
export type WebhookRoute = z.infer<typeof WebhookRouteSchema>;
export type QueueConfig = z.infer<typeof QueueConfigSchema>;
export type BrowserConfig = z.infer<typeof BrowserConfigSchema>;
```

**Step 4: Run tests**

Run: `npx vitest run tests/config/schema.test.ts`
Expected: All 8 tests PASS

**Step 5: Commit**

```bash
git add src/config/schema.ts tests/config/schema.test.ts
git commit -m "feat(config): add Zod schema for config validation"
```

---

## Task 3: Config Loader

**Files:**
- Create: `src/config/loader.ts`
- Test: `tests/config/loader.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/config/loader.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../../src/config/loader.js';

describe('loadConfig', () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  function writeConfig(yaml: string): string {
    tempDir = mkdtempSync(join(tmpdir(), 'harness-test-'));
    const path = join(tempDir, 'config.yaml');
    writeFileSync(path, yaml);
    return path;
  }

  it('should load and validate a minimal config', () => {
    const path = writeConfig(`
telegram:
  bot_token: "abc123"
  allowed_users: [111]
`);
    const config = loadConfig(path);
    expect(config.telegram?.bot_token).toBe('abc123');
    expect(config.cron).toEqual([]);
  });

  it('should substitute environment variables', () => {
    process.env.TEST_TOKEN = 'from-env';
    const path = writeConfig(`
telegram:
  bot_token: "\${TEST_TOKEN}"
  allowed_users: [111]
`);
    const config = loadConfig(path);
    expect(config.telegram?.bot_token).toBe('from-env');
    delete process.env.TEST_TOKEN;
  });

  it('should throw on missing env var', () => {
    const path = writeConfig(`
telegram:
  bot_token: "\${DOES_NOT_EXIST}"
  allowed_users: [111]
`);
    expect(() => loadConfig(path)).toThrow('DOES_NOT_EXIST');
  });

  it('should throw on missing file', () => {
    expect(() => loadConfig('/no/such/file.yaml')).toThrow('Failed to read config');
  });

  it('should throw on invalid YAML', () => {
    const path = writeConfig(': invalid: [[[');
    expect(() => loadConfig(path)).toThrow();
  });

  it('should throw on schema validation failure', () => {
    const path = writeConfig(`
telegram:
  bot_token: ""
  allowed_users: []
`);
    expect(() => loadConfig(path)).toThrow('Config validation failed');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/config/loader.test.ts`
Expected: FAIL — cannot find module

**Step 3: Write the implementation**

```typescript
// src/config/loader.ts
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { ConfigSchema, type Config } from './schema.js';

function substituteEnvVars(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\{([^}]+)\}/g, (_, varName: string) => {
      const envValue = process.env[varName];
      if (envValue === undefined) {
        throw new Error(`Environment variable ${varName} not found`);
      }
      return envValue;
    });
  }
  if (Array.isArray(value)) return value.map(substituteEnvVars);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, substituteEnvVars(v)])
    );
  }
  return value;
}

export function loadConfig(configPath: string): Config {
  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf-8');
  } catch (err) {
    throw new Error(`Failed to read config file at ${configPath}: ${(err as Error).message}`);
  }

  const parsed = parseYaml(raw);
  const substituted = substituteEnvVars(parsed);

  const result = ConfigSchema.safeParse(substituted);
  if (!result.success) {
    const msgs = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
    throw new Error(`Config validation failed: ${msgs}`);
  }
  return result.data;
}
```

**Step 4: Run tests**

Run: `npx vitest run tests/config/loader.test.ts`
Expected: All 6 tests PASS

**Step 5: Commit**

```bash
git add src/config/loader.ts tests/config/loader.test.ts
git commit -m "feat(config): add config loader with YAML parsing and env var substitution"
```

---

## Task 4: Logger

**Files:**
- Create: `src/logger.ts`
- Test: `tests/logger.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/logger.test.ts
import { describe, it, expect } from 'vitest';
import { createLogger } from '../src/logger.js';

describe('createLogger', () => {
  it('should create a logger with default level info', () => {
    const log = createLogger({ pretty: false });
    expect(log.level).toBe('info');
  });

  it('should accept custom level', () => {
    const log = createLogger({ level: 'debug', pretty: false });
    expect(log.level).toBe('debug');
  });

  it('should create child loggers', () => {
    const log = createLogger({ pretty: false });
    const child = log.child({ component: 'test' });
    expect(child).toBeDefined();
    expect(child.bindings()).toHaveProperty('component', 'test');
  });
});
```

**Step 2: Run to verify failure**

Run: `npx vitest run tests/logger.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/logger.ts
import pino from 'pino';

export interface LoggerOptions {
  level?: string;
  pretty?: boolean;
}

export function createLogger(options: LoggerOptions = {}) {
  const { level = 'info', pretty = process.env.NODE_ENV !== 'production' } = options;

  return pino({
    name: 'claude-conductor',
    level,
    transport: pretty
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' } }
      : undefined
  });
}
```

**Step 4: Run tests**

Run: `npx vitest run tests/logger.test.ts`
Expected: All 3 tests PASS

**Step 5: Commit**

```bash
git add src/logger.ts tests/logger.test.ts
git commit -m "feat(logger): add pino logger factory with pretty-print support"
```

---

## Task 5: Claude Code Invocation Wrapper

**Files:**
- Create: `src/claude/invoke.ts`
- Test: `tests/claude/invoke.test.ts`

This is the core of the harness. It wraps `claude -p` with proper flag construction, timeout handling, and output capture.

**Step 1: Write the failing test**

```typescript
// tests/claude/invoke.test.ts
import { describe, it, expect, vi } from 'vitest';
import { buildClaudeArgs, parseClaudeOutput, type ClaudeResult } from '../../src/claude/invoke.js';

describe('buildClaudeArgs', () => {
  it('should build basic args with prompt', () => {
    const args = buildClaudeArgs({ prompt: 'hello' });
    expect(args).toContain('-p');
    expect(args).toContain('hello');
    expect(args).toContain('--output-format');
    expect(args).toContain('json');
    expect(args).toContain('--max-turns');
    expect(args).toContain('25');
  });

  it('should include --session-id when provided', () => {
    const args = buildClaudeArgs({ prompt: 'hi', sessionId: 'abc-123' });
    expect(args).toContain('--session-id');
    expect(args).toContain('abc-123');
  });

  it('should include --resume when true', () => {
    const args = buildClaudeArgs({ prompt: 'hi', resume: true });
    expect(args).toContain('--resume');
  });

  it('should include --allowedTools as space-separated values', () => {
    const args = buildClaudeArgs({ prompt: 'hi', allowedTools: ['Read', 'Glob', 'Grep'] });
    expect(args).toContain('--allowedTools');
    // Each tool is a separate arg after --allowedTools
    const idx = args.indexOf('--allowedTools');
    expect(args[idx + 1]).toBe('Read');
    expect(args[idx + 2]).toBe('Glob');
    expect(args[idx + 3]).toBe('Grep');
  });

  it('should include --dangerously-skip-permissions when true', () => {
    const args = buildClaudeArgs({ prompt: 'hi', dangerouslySkipPermissions: true });
    expect(args).toContain('--dangerously-skip-permissions');
  });

  it('should include --no-session-persistence when true', () => {
    const args = buildClaudeArgs({ prompt: 'hi', noSessionPersistence: true });
    expect(args).toContain('--no-session-persistence');
  });

  it('should include --append-system-prompt when provided', () => {
    const args = buildClaudeArgs({ prompt: 'hi', appendSystemPrompt: 'extra context' });
    expect(args).toContain('--append-system-prompt');
    expect(args).toContain('extra context');
  });

  it('should respect custom maxTurns', () => {
    const args = buildClaudeArgs({ prompt: 'hi', maxTurns: 10 });
    const idx = args.indexOf('--max-turns');
    expect(args[idx + 1]).toBe('10');
  });
});

describe('parseClaudeOutput', () => {
  it('should parse valid JSON stdout', () => {
    const result: ClaudeResult = { exitCode: 0, stdout: '{"result":"ok"}', stderr: '', timedOut: false };
    expect(parseClaudeOutput(result)).toEqual({ result: 'ok' });
  });

  it('should return null for non-zero exit code', () => {
    const result: ClaudeResult = { exitCode: 1, stdout: '{"x":1}', stderr: 'err', timedOut: false };
    expect(parseClaudeOutput(result)).toBeNull();
  });

  it('should return null for invalid JSON', () => {
    const result: ClaudeResult = { exitCode: 0, stdout: 'not json', stderr: '', timedOut: false };
    expect(parseClaudeOutput(result)).toBeNull();
  });

  it('should return null on timeout', () => {
    const result: ClaudeResult = { exitCode: -1, stdout: '', stderr: '', timedOut: true };
    expect(parseClaudeOutput(result)).toBeNull();
  });
});
```

**Step 2: Run to verify failure**

Run: `npx vitest run tests/claude/invoke.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/claude/invoke.ts
import { spawn } from 'node:child_process';
import type { Logger } from 'pino';

export interface ClaudeInvokeOptions {
  prompt: string;
  workingDir?: string;
  sessionId?: string;
  resume?: boolean;
  allowedTools?: string[];
  dangerouslySkipPermissions?: boolean;
  noSessionPersistence?: boolean;
  maxTurns?: number;
  outputFormat?: 'text' | 'json' | 'stream-json';
  appendSystemPrompt?: string;
  timeout?: number;
  logger?: Logger;
}

export interface ClaudeResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export function buildClaudeArgs(options: ClaudeInvokeOptions): string[] {
  const {
    prompt,
    sessionId,
    resume = false,
    allowedTools,
    dangerouslySkipPermissions = false,
    noSessionPersistence = false,
    maxTurns = 25,
    outputFormat = 'json',
    appendSystemPrompt,
  } = options;

  const args: string[] = ['-p', prompt];

  if (sessionId) args.push('--session-id', sessionId);
  if (resume) args.push('--resume');
  if (dangerouslySkipPermissions) args.push('--dangerously-skip-permissions');
  if (noSessionPersistence) args.push('--no-session-persistence');
  if (allowedTools && allowedTools.length > 0) {
    args.push('--allowedTools', ...allowedTools);
  }
  if (appendSystemPrompt) args.push('--append-system-prompt', appendSystemPrompt);

  args.push('--max-turns', String(maxTurns));
  args.push('--output-format', outputFormat);

  return args;
}

export async function invokeClaude(options: ClaudeInvokeOptions): Promise<ClaudeResult> {
  const { workingDir = '/vault', timeout = 300_000, logger } = options;
  const args = buildClaudeArgs(options);

  logger?.debug({ args, workingDir }, 'Invoking Claude Code');

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    const child = spawn('claude', args, {
      cwd: workingDir,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    if (timeout > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        logger?.warn({ timeout }, 'Claude Code timed out');
        child.kill('SIGTERM');
        setTimeout(() => { if (!child.killed) child.kill('SIGKILL'); }, 5000);
      }, timeout);
    }

    child.on('error', (err) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      logger?.error({ err }, 'Claude Code spawn error');
      resolve({ exitCode: -1, stdout, stderr: stderr || err.message, timedOut });
    });

    child.on('close', (code) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      logger?.debug({ exitCode: code, timedOut }, 'Claude Code finished');
      resolve({ exitCode: code ?? -1, stdout, stderr, timedOut });
    });
  });
}

export function parseClaudeOutput(result: ClaudeResult): unknown | null {
  if (result.exitCode !== 0 || result.timedOut) return null;
  try { return JSON.parse(result.stdout); }
  catch { return null; }
}
```

**Step 4: Run tests**

Run: `npx vitest run tests/claude/invoke.test.ts`
Expected: All 12 tests PASS

**Step 5: Commit**

```bash
git add src/claude/invoke.ts tests/claude/invoke.test.ts
git commit -m "feat(claude): add invocation wrapper with flag building, timeout, and output parsing"
```

---

## Task 6: Health Check Endpoint

**Files:**
- Create: `src/server/health.ts`
- Test: `tests/server/health.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/server/health.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerHealthRoute } from '../../src/server/health.js';

describe('/health', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    registerHealthRoute(app);
    await app.ready();
  });

  afterEach(() => app.close());

  it('should return 200', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });

  it('should return status field', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    const body = res.json();
    expect(body).toHaveProperty('status');
    expect(['healthy', 'degraded', 'unhealthy']).toContain(body.status);
  });

  it('should return uptime as a number', async () => {
    const body = (await app.inject({ method: 'GET', url: '/health' })).json();
    expect(typeof body.uptime).toBe('number');
    expect(body.uptime).toBeGreaterThanOrEqual(0);
  });

  it('should return a valid ISO timestamp', async () => {
    const body = (await app.inject({ method: 'GET', url: '/health' })).json();
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });

  it('should return version string', async () => {
    const body = (await app.inject({ method: 'GET', url: '/health' })).json();
    expect(typeof body.version).toBe('string');
  });
});
```

**Step 2: Run to verify failure**

Run: `npx vitest run tests/server/health.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/server/health.ts
import type { FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  uptime: number;
  timestamp: string;
  checks: Record<string, boolean>;
}

export function registerHealthRoute(app: FastifyInstance) {
  app.get('/health', async (_req, reply) => {
    const checks: Record<string, boolean> = {
      vault: existsSync('/vault'),
      config: existsSync('/config'),
    };

    const passed = Object.values(checks).filter(Boolean).length;
    const total = Object.values(checks).length;
    const status: HealthStatus['status'] =
      passed === total ? 'healthy' : passed > 0 ? 'degraded' : 'unhealthy';

    const body: HealthStatus = {
      status,
      version: process.env.npm_package_version ?? '0.1.0',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      checks,
    };

    reply.code(status === 'unhealthy' ? 503 : 200).send(body);
  });
}
```

**Step 4: Run tests**

Run: `npx vitest run tests/server/health.test.ts`
Expected: All 5 tests PASS

**Step 5: Commit**

```bash
git add src/server/health.ts tests/server/health.test.ts
git commit -m "feat(server): add /health endpoint with directory checks and status"
```

---

## Task 7: Main Entry Point

**Files:**
- Create: `src/main.ts`
- Test: `tests/main.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/main.test.ts
import { describe, it, expect } from 'vitest';

describe('main module', () => {
  it('should export a main function', async () => {
    const mod = await import('../src/main.js');
    expect(typeof mod.main).toBe('function');
  });
});
```

**Step 2: Run to verify failure**

Run: `npx vitest run tests/main.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/main.ts
import Fastify from 'fastify';
import { loadConfig } from './config/loader.js';
import { createLogger } from './logger.js';
import { registerHealthRoute } from './server/health.js';

export async function main() {
  const logger = createLogger({
    level: process.env.LOG_LEVEL ?? 'info',
    pretty: process.env.NODE_ENV !== 'production',
  });

  logger.info('Claude Harness starting');

  // Load config
  const configPath = process.env.CONFIG_PATH ?? '/config/config.yaml';
  let config;
  try {
    config = loadConfig(configPath);
    logger.info({ configPath }, 'Config loaded');
  } catch (err) {
    logger.fatal({ err, configPath }, 'Failed to load config');
    process.exit(1);
  }

  // HTTP server
  const port = parseInt(process.env.PORT ?? '3000', 10);
  const host = process.env.HOST ?? '0.0.0.0';

  const app = Fastify({ logger });
  registerHealthRoute(app);

  try {
    await app.listen({ port, host });
  } catch (err) {
    logger.fatal({ err }, 'Failed to start server');
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  logger.info('Claude Harness ready');
}

// Run when executed directly
const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isDirectRun) {
  main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
```

**Step 4: Run tests**

Run: `npx vitest run tests/main.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/main.ts tests/main.test.ts
git commit -m "feat(main): add entry point with config loading, server startup, and graceful shutdown"
```

---

## Task 8: Dockerfile & Docker Compose

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `docker-compose.yml`
- Create: `config.example.yaml`

**Step 1: Create Dockerfile**

```dockerfile
# Stage 1: Build
FROM node:20-slim AS builder
WORKDIR /build
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

# Stage 2: Production
FROM node:20-slim

RUN apt-get update && apt-get install -y ca-certificates curl git && rm -rf /var/lib/apt/lists/*

# Create non-root user BEFORE installing Claude CLI
# so the installer puts the binary in /home/claude/.local/bin
RUN useradd -m -u 1000 -s /bin/bash claude

# Copy built app and install production deps as root
WORKDIR /app
COPY --from=builder /build/dist ./dist
COPY --from=builder /build/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Volume mount points — create and chown as root
RUN mkdir -p /vault /config /data /home/claude/.claude && \
    chown -R claude:claude /vault /config /data /home/claude /app

# Switch to claude user, then install Claude CLI natively
# This ensures the binary lands in /home/claude/.local/bin
USER claude
RUN curl -fsSL https://claude.ai/install.sh | bash

ENV PATH="/home/claude/.local/bin:$PATH" \
    NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    CONFIG_PATH=/config/config.yaml \
    LOG_LEVEL=info

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

CMD ["node", "dist/main.js"]
```

**Step 2: Create .dockerignore**

```
node_modules/
dist/
coverage/
tests/
.git/
.env
*.log
docs/
```

**Step 3: Create docker-compose.yml**

```yaml
services:
  claude-harness:
    build: .
    container_name: claude-harness
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - vault:/vault
      - ./config:/config:ro
      - data:/data
      - claude-config:/home/claude/.claude
    environment:
      - NODE_ENV=production
      - LOG_LEVEL=info
    deploy:
      resources:
        limits:
          memory: 2G

volumes:
  vault:
  data:
  claude-config:
```

**Step 4: Create config.example.yaml**

```yaml
# Claude Harness — example config
# Copy to config/config.yaml and fill in values

telegram:
  bot_token: "${TELEGRAM_BOT_TOKEN}"
  allowed_users:
    - 123456789  # Your Telegram user ID

cron:
  - name: heartbeat
    schedule: "*/30 * * * *"
    prompt: "Run a quick health check. Verify vault is accessible."
    output: log

webhooks: []

queue:
  max_concurrent: 1
  timeout_seconds: 300

browser:
  enabled: false
```

**Step 5: Commit**

```bash
git add Dockerfile .dockerignore docker-compose.yml config.example.yaml
git commit -m "feat(docker): add Dockerfile with native Claude CLI install, compose, and example config"
```

---

## Task 9: Run Full Test Suite & Verify Build

**Step 1: Run all tests**

Run: `npm test`
Expected: All tests pass (schema: 8, loader: 6, logger: 3, invoke: 12, health: 5, main: 1 = ~35 tests)

**Step 2: Verify TypeScript build**

Run: `npm run build`
Expected: `dist/` directory created with compiled JS, no type errors

**Step 3: Verify Docker build**

Run: `docker build -t claude-harness .`
Expected: Image builds successfully (Claude CLI install may need network access)

**Step 4: Commit any fixes if needed, then tag**

```bash
git tag v0.1.0-phase1
```

---

## Verification

After all tasks are complete, verify end-to-end:

1. **Tests:** `npm test` — all pass
2. **Build:** `npm run build` — compiles without errors
3. **Docker:** `docker build -t claude-harness .` — image builds
4. **Health check:** Start container, `curl http://localhost:3000/health` — returns JSON with status
5. **Config loading:** Create a `config/config.yaml` from `config.example.yaml`, verify the app starts and logs "Config loaded"

## File Summary

```
src/
  config/
    schema.ts       — Zod validation schemas
    loader.ts       — YAML loader with env var substitution
  claude/
    invoke.ts       — Claude CLI wrapper (buildArgs, invoke, parseOutput)
  server/
    health.ts       — GET /health route
  logger.ts         — Pino logger factory
  main.ts           — Entry point
tests/
  config/
    schema.test.ts
    loader.test.ts
  claude/
    invoke.test.ts
  server/
    health.test.ts
  logger.test.ts
  main.test.ts
Dockerfile
.dockerignore
docker-compose.yml
config.example.yaml
package.json
tsconfig.json
vitest.config.ts
.gitignore
```
