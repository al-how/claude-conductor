import { describe, it, expect } from 'vitest';
import { ConfigSchema, CronJobSchema } from '../../src/config/schema.js';

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
        const result = CronJobSchema.safeParse({
            name: 'test', schedule: '0 7 * * *', prompt: 'do stuff'
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.output).toBe('log'); // default
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

    it('should accept browser config with user_data_dir and vnc_port', () => {
        const result = ConfigSchema.safeParse({
            browser: {
                enabled: true,
                user_data_dir: '/data/browser-profile',
                vnc_port: 6080
            }
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.browser.enabled).toBe(true);
            expect(result.data.browser.user_data_dir).toBe('/data/browser-profile');
            expect(result.data.browser.vnc_port).toBe(6080);
        }
    });

    it('should apply browser config defaults', () => {
        const result = ConfigSchema.safeParse({
            browser: { enabled: true }
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.browser.user_data_dir).toBe('/data/browser-profile');
            expect(result.data.browser.vnc_port).toBe(6080);
        }
    });

    it('should reject browser vnc_port outside valid range', () => {
        const result = ConfigSchema.safeParse({
            browser: { enabled: true, vnc_port: 99 }
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
