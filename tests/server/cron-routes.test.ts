import { describe, it, expect, vi, beforeEach } from 'vitest';
import fastify, { type FastifyInstance } from 'fastify';
import { registerCronRoutes } from '../../src/server/cron-routes.js';
import type { DatabaseManager } from '../../src/db/index.js';
import type { CronScheduler } from '../../src/cron/scheduler.js';
import type { OllamaConfig, OpenRouterConfig } from '../../src/config/schema.js';

describe('Cron API Routes', () => {
    const app = fastify();

    const mockDb = {
        listCronJobs: vi.fn(),
        getCronJob: vi.fn(),
        createCronJob: vi.fn(),
        updateCronJob: vi.fn(),
        deleteCronJob: vi.fn(),
    } as unknown as DatabaseManager;

    const mockScheduler = {
        addJob: vi.fn(),
        removeJob: vi.fn()
    } as unknown as CronScheduler;

    registerCronRoutes(app, mockDb, mockScheduler, false);

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('POST /api/cron should create a job', async () => {
        const payload = {
            name: 'new-job',
            schedule: '* * * * *',
            prompt: 'do something',
            output: 'log'
        };

        (mockDb.getCronJob as any).mockReturnValue(undefined); // No existing
        (mockDb.createCronJob as any).mockReturnValue({ ...payload, id: 1, enabled: 1, timezone: 'America/Chicago' });

        const response = await app.inject({
            method: 'POST',
            url: '/api/cron',
            payload
        });

        expect(response.statusCode).toBe(201);
        expect(mockDb.createCronJob).toHaveBeenCalledWith(expect.objectContaining({
            name: 'new-job'
        }));
        expect(mockScheduler.addJob).toHaveBeenCalled();
    });

    it('POST /api/cron shoud return 409 if exists', async () => {
        (mockDb.getCronJob as any).mockReturnValue({ name: 'existing' });

        const response = await app.inject({
            method: 'POST',
            url: '/api/cron',
            payload: { name: 'existing', schedule: '*', prompt: 'x' }
        });

        expect(response.statusCode).toBe(409);
    });

    it('GET /api/cron should list jobs', async () => {
        (mockDb.listCronJobs as any).mockReturnValue([{ name: 'j1' }]);

        const response = await app.inject({
            method: 'GET',
            url: '/api/cron'
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ jobs: [{ name: 'j1' }] });
    });

    it('DELETE /api/cron/:name should remove job', async () => {
        (mockDb.deleteCronJob as any).mockReturnValue(true);

        const response = await app.inject({
            method: 'DELETE',
            url: '/api/cron/test-job'
        });

        expect(response.statusCode).toBe(200);
        expect(mockScheduler.removeJob).toHaveBeenCalledWith('test-job');
    });

    it('POST /api/cron should return 400 on invalid input', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/api/cron',
            payload: { name: '', schedule: '', prompt: '' }
        });

        expect(response.statusCode).toBe(400);
        expect(response.json()).toHaveProperty('error', 'Validation failed');
    });

    it('GET /api/cron/:name should return a single job', async () => {
        const mockJob = { id: 1, name: 'single-job', schedule: '* * * * *', prompt: 'test', output: 'log', enabled: 1 };
        (mockDb.getCronJob as any).mockReturnValue(mockJob);

        const response = await app.inject({
            method: 'GET',
            url: '/api/cron/single-job'
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ job: mockJob });
    });

    it('PATCH /api/cron/:name should update a job', async () => {
        const updatedJob = { id: 1, name: 'patch-job', schedule: '5 * * * *', prompt: 'updated', output: 'log', enabled: 1, timezone: 'America/Chicago' };
        (mockDb.updateCronJob as any).mockReturnValue(updatedJob);

        const response = await app.inject({
            method: 'PATCH',
            url: '/api/cron/patch-job',
            payload: { schedule: '5 * * * *' }
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ job: updatedJob });
        expect(mockScheduler.removeJob).toHaveBeenCalledWith('patch-job');
        expect(mockScheduler.addJob).toHaveBeenCalledWith(updatedJob);
    });

    it('DELETE /api/cron/:name should return 404 for nonexistent job', async () => {
        (mockDb.deleteCronJob as any).mockReturnValue(false);

        const response = await app.inject({
            method: 'DELETE',
            url: '/api/cron/nonexistent'
        });

        expect(response.statusCode).toBe(404);
    });

    it('POST /api/cron should create a job with custom timezone', async () => {
        const payload = {
            name: 'tz-job',
            schedule: '0 9 * * *',
            prompt: 'good morning',
            output: 'log',
            timezone: 'America/New_York'
        };

        (mockDb.getCronJob as any).mockReturnValue(undefined);
        (mockDb.createCronJob as any).mockReturnValue({ ...payload, id: 2, enabled: 1 });

        const response = await app.inject({
            method: 'POST',
            url: '/api/cron',
            payload
        });

        expect(response.statusCode).toBe(201);
        expect(mockDb.createCronJob).toHaveBeenCalledWith(expect.objectContaining({
            timezone: 'America/New_York'
        }));
    });

    it('POST /api/cron should create a job with model field', async () => {
        const payload = {
            name: 'model-job',
            schedule: '0 9 * * *',
            prompt: 'test prompt',
            model: 'haiku'
        };

        (mockDb.getCronJob as any).mockReturnValue(undefined);
        (mockDb.createCronJob as any).mockReturnValue({ ...payload, id: 3, enabled: 1, timezone: 'America/Chicago' });

        const response = await app.inject({
            method: 'POST',
            url: '/api/cron',
            payload
        });

        expect(response.statusCode).toBe(201);
        expect(mockDb.createCronJob).toHaveBeenCalledWith(expect.objectContaining({
            model: 'haiku'
        }));
        const body = response.json();
        expect(body.job.model).toBe('haiku');
    });

    it('POST /api/cron should reject execution_mode: api when apiEnabled is false', async () => {
        const payload = {
            name: 'api-job',
            schedule: '0 9 * * *',
            prompt: 'test prompt',
            execution_mode: 'api'
        };

        const response = await app.inject({
            method: 'POST',
            url: '/api/cron',
            payload
        });

        expect(response.statusCode).toBe(400);
        expect(response.json()).toHaveProperty('error');
        expect(response.json().error).toContain('API execution mode');
    });

    it('PATCH /api/cron/:name should reject execution_mode: api when apiEnabled is false', async () => {
        const response = await app.inject({
            method: 'PATCH',
            url: '/api/cron/some-job',
            payload: { execution_mode: 'api' }
        });

        expect(response.statusCode).toBe(400);
        expect(response.json().error).toContain('API execution mode');
    });

    it('PATCH /api/cron/:name should update timezone', async () => {
        const updatedJob = { id: 1, name: 'tz-patch', schedule: '0 9 * * *', prompt: 'test', output: 'log', enabled: 1, timezone: 'Europe/London' };
        (mockDb.updateCronJob as any).mockReturnValue(updatedJob);

        const response = await app.inject({
            method: 'PATCH',
            url: '/api/cron/tz-patch',
            payload: { timezone: 'Europe/London' }
        });

        expect(response.statusCode).toBe(200);
        expect(response.json().job.timezone).toBe('Europe/London');
        expect(mockDb.updateCronJob).toHaveBeenCalledWith('tz-patch', expect.objectContaining({
            timezone: 'Europe/London'
        }));
    });
});

describe('Cron API Routes — provider validation', () => {
    let appWithProviders: FastifyInstance;

    const openRouterConfig: OpenRouterConfig = {
        api_key: 'sk-test',
        base_url: 'https://openrouter.ai/api',
        allowed_models: ['qwen/qwen3-coder', 'google/gemini-2.0-flash'],
        default_model: 'qwen/qwen3-coder',
    };

    const ollamaConfig: OllamaConfig = {
        base_url: 'http://localhost:11434',
        allowed_models: ['llama3', 'qwen3-coder'],
    };

    const mockDb2 = {
        listCronJobs: vi.fn(),
        getCronJob: vi.fn(),
        createCronJob: vi.fn(),
        updateCronJob: vi.fn(),
        deleteCronJob: vi.fn(),
    } as unknown as DatabaseManager;

    const mockScheduler2 = {
        addJob: vi.fn(),
        removeJob: vi.fn(),
    } as unknown as CronScheduler;

    beforeEach(async () => {
        vi.clearAllMocks();
        appWithProviders = fastify();
        registerCronRoutes(appWithProviders, mockDb2, mockScheduler2, true, ollamaConfig, openRouterConfig);
        await appWithProviders.ready();
    });

    it('POST /api/cron should pass provider to createCronJob', async () => {
        (mockDb2.getCronJob as any).mockReturnValue(undefined);
        (mockDb2.createCronJob as any).mockReturnValue({
            name: 'or-job', schedule: '0 9 * * *', prompt: 'test',
            provider: 'openrouter', id: 1, enabled: 1
        });

        const response = await appWithProviders.inject({
            method: 'POST',
            url: '/api/cron',
            payload: {
                name: 'or-job',
                schedule: '0 9 * * *',
                prompt: 'test',
                provider: 'openrouter',
            }
        });

        expect(response.statusCode).toBe(201);
        expect(mockDb2.createCronJob).toHaveBeenCalledWith(
            expect.objectContaining({ provider: 'openrouter' })
        );
    });

    it('POST /api/cron should reject api mode with non-Claude provider', async () => {
        (mockDb2.getCronJob as any).mockReturnValue(undefined);

        const response = await appWithProviders.inject({
            method: 'POST',
            url: '/api/cron',
            payload: {
                name: 'or-api-job',
                schedule: '0 9 * * *',
                prompt: 'test',
                execution_mode: 'api',
                provider: 'openrouter',
            }
        });

        expect(response.statusCode).toBe(400);
        expect(response.json().error).toContain("execution_mode 'api' only supports provider 'claude'");
    });

    it('PATCH /api/cron/:name should reject adding openrouter provider to an api-mode job', async () => {
        (mockDb2.getCronJob as any).mockReturnValue({
            name: 'api-job',
            execution_mode: 'api',
            provider: null,
        });
        (mockDb2.updateCronJob as any).mockReturnValue(undefined);

        const response = await appWithProviders.inject({
            method: 'PATCH',
            url: '/api/cron/api-job',
            payload: { provider: 'openrouter' }
        });

        expect(response.statusCode).toBe(400);
        expect(response.json().error).toContain("execution_mode 'api' only supports provider 'claude'");
    });

    it('PATCH /api/cron/:name should reject switching cli+openrouter job to api mode', async () => {
        (mockDb2.getCronJob as any).mockReturnValue({
            name: 'or-cli-job',
            execution_mode: 'cli',
            provider: 'openrouter',
        });

        const response = await appWithProviders.inject({
            method: 'PATCH',
            url: '/api/cron/or-cli-job',
            payload: { execution_mode: 'api' }
        });

        expect(response.statusCode).toBe(400);
        expect(response.json().error).toContain("execution_mode 'api' only supports provider 'claude'");
    });

    it('GET /api/models should return provider-grouped metadata', async () => {
        const response = await appWithProviders.inject({ method: 'GET', url: '/api/models' });

        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.claude).toBeInstanceOf(Array);
        expect(body.openrouter).toBeDefined();
        expect(body.openrouter.models).toContain('qwen/qwen3-coder');
        expect(body.openrouter.default_model).toBe('qwen/qwen3-coder');
        expect(body.ollama).toBeDefined();
        expect(body.ollama.models).toContain('llama3');
    });

    it('GET /api/models should return null for unconfigured providers', async () => {
        const bareApp = fastify();
        registerCronRoutes(bareApp, mockDb2, mockScheduler2, false);
        await bareApp.ready();

        const response = await bareApp.inject({ method: 'GET', url: '/api/models' });
        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.openrouter).toBeNull();
        expect(body.ollama).toBeNull();
    });
});
