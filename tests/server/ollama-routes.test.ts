import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fastify, type FastifyInstance } from 'fastify';
import { registerCronRoutes } from '../../src/server/cron-routes.js';

describe('GET /api/ollama/models', () => {
    let app: FastifyInstance;

    beforeEach(async () => {
        app = fastify();
    });

    it('should return available: false when ollama is not configured', async () => {
        registerCronRoutes(app, {} as any, {} as any, false);
        await app.ready();
        const res = await app.inject({ method: 'GET', url: '/api/ollama/models' });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ models: [], available: false, error: 'No ollama.base_url configured' });
    });

    it('should return models from ollama when configured', async () => {
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
        expect(res.json()).toEqual({ models: [], available: false, error: 'Cannot reach Ollama at http://192.168.1.100:11434' });

        vi.unstubAllGlobals();
    });
});
