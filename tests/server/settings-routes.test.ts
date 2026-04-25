import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fastify from 'fastify';
import { registerSettingsRoutes } from '../../src/server/settings-routes.js';
import type { Config } from '../../src/config/schema.js';

vi.mock('../../src/config/writer.js', () => ({
    updateConfigField: vi.fn(),
    deleteConfigField: vi.fn(),
}));

import { updateConfigField, deleteConfigField } from '../../src/config/writer.js';

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
        // Telegram subsection only exposes the timeout knob, never the bot token
        expect(body.telegram).toEqual({ timeout_seconds: null });
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

    it('PATCH /api/settings should accept queue.timeout_seconds up to 86400', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/settings',
            payload: { queue: { timeout_seconds: 86400 } },
        });
        expect(res.statusCode).toBe(200);
        expect(config.queue.timeout_seconds).toBe(86400);
        expect(updateConfigField).toHaveBeenCalledWith('queue.timeout_seconds', 86400);
    });

    describe('telegram.timeout_seconds', () => {
        beforeEach(() => {
            config.telegram = {
                bot_token: 'secret',
                allowed_users: [1],
                streaming_enabled: true,
                show_tool_events: true,
            };
        });

        it('GET should expose telegram.timeout_seconds when set', async () => {
            config.telegram!.timeout_seconds = 7200;
            const res = await app.inject({ method: 'GET', url: '/api/settings' });
            expect(res.json().telegram).toEqual({ timeout_seconds: 7200 });
        });

        it('PATCH should set telegram.timeout_seconds', async () => {
            const res = await app.inject({
                method: 'PATCH',
                url: '/api/settings',
                payload: { telegram: { timeout_seconds: 3600 } },
            });
            expect(res.statusCode).toBe(200);
            expect(res.json().telegram).toEqual({ timeout_seconds: 3600 });
            expect(config.telegram!.timeout_seconds).toBe(3600);
            expect(updateConfigField).toHaveBeenCalledWith('telegram.timeout_seconds', 3600);
        });

        it('PATCH with null should clear telegram.timeout_seconds and delete the YAML key', async () => {
            config.telegram!.timeout_seconds = 3600;
            const res = await app.inject({
                method: 'PATCH',
                url: '/api/settings',
                payload: { telegram: { timeout_seconds: null } },
            });
            expect(res.statusCode).toBe(200);
            expect(res.json().telegram).toEqual({ timeout_seconds: null });
            expect(config.telegram!.timeout_seconds).toBeUndefined();
            expect(deleteConfigField).toHaveBeenCalledWith('telegram.timeout_seconds');
        });

        it('PATCH should reject telegram.timeout_seconds below 30', async () => {
            const res = await app.inject({
                method: 'PATCH',
                url: '/api/settings',
                payload: { telegram: { timeout_seconds: 5 } },
            });
            expect(res.statusCode).toBe(400);
        });

        it('PATCH should reject telegram.timeout_seconds above 86400', async () => {
            const res = await app.inject({
                method: 'PATCH',
                url: '/api/settings',
                payload: { telegram: { timeout_seconds: 100000 } },
            });
            expect(res.statusCode).toBe(400);
        });

        it('PATCH should be a no-op when telegram is not configured', async () => {
            config.telegram = undefined;
            const res = await app.inject({
                method: 'PATCH',
                url: '/api/settings',
                payload: { telegram: { timeout_seconds: 3600 } },
            });
            expect(res.statusCode).toBe(200);
            expect(res.json().telegram).toEqual({ timeout_seconds: null });
            expect(updateConfigField).not.toHaveBeenCalledWith('telegram.timeout_seconds', expect.anything());
        });
    });
});
