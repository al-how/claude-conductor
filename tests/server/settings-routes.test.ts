import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fastify from 'fastify';
import { registerSettingsRoutes } from '../../src/server/settings-routes.js';
import type { Config } from '../../src/config/schema.js';

vi.mock('../../src/config/writer.js', () => ({
    updateConfigField: vi.fn(),
}));

import { updateConfigField } from '../../src/config/writer.js';

describe('Settings API Routes', () => {
    let app: ReturnType<typeof fastify>;
    let config: Config;

    beforeEach(async () => {
        vi.clearAllMocks();
        config = {
            vault_path: '/vault',
            model: 'sonnet',
            queue: { max_concurrent: 1, timeout_seconds: 300, priority: { telegram: 1, cron: 2, webhook: 3 } },
            webhooks: [],
            browser: { enabled: false, headless: true, vnc: false },
        } as Config;

        app = fastify({ logger: false });
        registerSettingsRoutes(app, config);
        await app.ready();
    });

    afterEach(() => app.close());

    it('GET /api/settings should return safe config subset', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/settings' });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.model).toBe('sonnet');
        expect(body.vault_path).toBe('/vault');
        expect(body.queue.max_concurrent).toBe(1);
        expect(body.telegram_enabled).toBe(false);
        expect(body.api_enabled).toBe(false);
        // Should not contain secrets
        expect(body).not.toHaveProperty('telegram');
        expect(body).not.toHaveProperty('api');
    });

    it('PATCH /api/settings should update model', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/settings',
            payload: { model: 'opus' },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json().model).toBe('opus');
        expect(config.model).toBe('opus');
        expect(updateConfigField).toHaveBeenCalledWith('model', 'opus');
    });

    it('PATCH /api/settings should update queue settings', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/settings',
            payload: { queue: { max_concurrent: 3 } },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json().queue.max_concurrent).toBe(3);
        expect(config.queue.max_concurrent).toBe(3);
        expect(updateConfigField).toHaveBeenCalledWith('queue.max_concurrent', 3);
    });

    it('PATCH /api/settings should return 400 on invalid input', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/settings',
            payload: { queue: { max_concurrent: 99 } },
        });
        expect(res.statusCode).toBe(400);
        expect(res.json()).toHaveProperty('error', 'Validation failed');
    });

    it('PATCH /api/settings should clear model with null', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/settings',
            payload: { model: null },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json().model).toBe(null);
        expect(config.model).toBeUndefined();
    });
});
