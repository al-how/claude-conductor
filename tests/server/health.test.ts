import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerHealthRoute } from '../../src/server/health.js';
import * as fs from 'node:fs';

vi.mock('node:fs', () => ({
    existsSync: vi.fn(),
}));

describe('/health', () => {
    let app: FastifyInstance;

    beforeEach(async () => {
        vi.resetAllMocks();
        // Default to healthy
        vi.mocked(fs.existsSync).mockReturnValue(true);

        app = Fastify({ logger: false });
        registerHealthRoute(app);
        await app.ready();
    });

    afterEach(() => app.close());

    it('should return 200 when healthy', async () => {
        const res = await app.inject({ method: 'GET', url: '/health' });
        expect(res.statusCode).toBe(200);
        expect(res.json().status).toBe('healthy');
    });

    it('should return 200 when degraded', async () => {
        // Mock one check failing
        vi.mocked(fs.existsSync).mockImplementation((path) => path === '/vault');

        const res = await app.inject({ method: 'GET', url: '/health' });
        expect(res.statusCode).toBe(200);
        expect(res.json().status).toBe('degraded');
    });

    it('should return 503 when unhealthy', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);

        const res = await app.inject({ method: 'GET', url: '/health' });
        expect(res.statusCode).toBe(503);
        expect(res.json().status).toBe('unhealthy');
    });

    it('should return uptime as a number', async () => {
        const body = (await app.inject({ method: 'GET', url: '/health' })).json();
        expect(typeof body.uptime).toBe('number');
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
