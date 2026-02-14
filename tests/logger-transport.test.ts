import { describe, it, expect } from 'vitest';
import { formatLogObject } from '../src/logger-transport.js';

const now = Date.now();

function log(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { time: now, level: 30, msg: '', ...overrides };
}

describe('formatLogObject', () => {
    describe('banner events', () => {
        it('should format startup as ASCII banner', () => {
            const out = formatLogObject(log({ event: 'startup' }));
            expect(out).toContain('╔');
            expect(out).toContain('╚');
            expect(out).toContain('🚀');
            expect(out).toContain('Claude Conductor starting');
        });

        it('should format shutdown as ASCII banner', () => {
            const out = formatLogObject(log({ event: 'shutdown' }));
            expect(out).toContain('╔');
            expect(out).toContain('🛑');
            expect(out).toContain('Claude Conductor shutting down');
        });
    });

    describe('session lifecycle events', () => {
        it('should format session_start with source and taskId', () => {
            const out = formatLogObject(log({ event: 'session_start', source: 'telegram', taskId: 'tg-123' }));
            expect(out).toContain('──');
            expect(out).toContain('🤖');
            expect(out).toContain('[telegram]');
            expect(out).toContain('tg-123');
        });

        it('should include prompt preview in session_start', () => {
            const out = formatLogObject(log({ event: 'session_start', source: 'cron', taskId: 'c-1', prompt: 'Check weather' }));
            expect(out).toContain('📝');
            expect(out).toContain('Check weather');
        });

        it('should format session_complete with duration and turns', () => {
            const out = formatLogObject(log({ event: 'session_complete', source: 'telegram', taskId: 'tg-123', duration: 28, numTurns: 3 }));
            expect(out).toContain('✅');
            expect(out).toContain('28s');
            expect(out).toContain('3 turns');
        });

        it('should format session_failed with error', () => {
            const out = formatLogObject(log({ event: 'session_failed', source: 'webhook', taskId: 'wh-1', err: { message: 'spawn failed' } }));
            expect(out).toContain('💥');
            expect(out).toContain('spawn failed');
        });

        it('should format session_timeout', () => {
            const out = formatLogObject(log({ event: 'session_timeout', source: 'cron', taskId: 'c-5' }));
            expect(out).toContain('⏳');
            expect(out).toContain('[cron]');
        });
    });

    describe('inline events', () => {
        it('should format session_queued with queue length', () => {
            const out = formatLogObject(log({ event: 'session_queued', source: 'telegram', taskId: 'tg-1', queueLength: 3 }));
            expect(out).toContain('📥');
            expect(out).toContain('(queue: 3)');
        });

        it('should format message_received with user and text preview', () => {
            const out = formatLogObject(log({ event: 'message_received', userId: 12345, text: 'Hello there' }));
            expect(out).toContain('📩');
            expect(out).toContain('12345');
            expect(out).toContain('Hello there');
        });

        it('should format cron_triggered', () => {
            const out = formatLogObject(log({ event: 'cron_triggered', name: 'daily-news' }));
            expect(out).toContain('⏰');
            expect(out).toContain('daily-news');
        });

        it('should format cron_scheduled', () => {
            const out = formatLogObject(log({ event: 'cron_scheduled', name: 'daily-news', schedule: '0 9 * * *' }));
            expect(out).toContain('📋');
            expect(out).toContain('daily-news');
            expect(out).toContain('0 9 * * *');
        });

        it('should format tool_use with arg', () => {
            const out = formatLogObject(log({ event: 'tool_use', tool: 'Read', arg: '/vault/notes/test.md' }));
            expect(out).toContain('🔧');
            expect(out).toContain('Read');
            expect(out).toContain('/vault/notes/test.md');
        });

        it('should format tool_use without arg', () => {
            const out = formatLogObject(log({ event: 'tool_use', tool: 'CustomMCP' }));
            expect(out).toContain('🔧');
            expect(out).toContain('CustomMCP');
            expect(out).not.toContain('→');
        });

        it('should format response_ready', () => {
            const out = formatLogObject(log({ event: 'response_ready', numTurns: 5, duration: 42 }));
            expect(out).toContain('💬');
            expect(out).toContain('5 turns');
            expect(out).toContain('42s');
        });

        it('should format auto_continue', () => {
            const out = formatLogObject(log({ event: 'auto_continue', continuationDepth: 1, maxDepth: 2 }));
            expect(out).toContain('🔄');
            expect(out).toContain('1/2');
        });
    });

    describe('level-based fallback', () => {
        it('should use error emoji for level 50', () => {
            const out = formatLogObject(log({ level: 50, msg: 'Something broke' }));
            expect(out).toContain('❌');
            expect(out).toContain('Something broke');
        });

        it('should use warn emoji for level 40', () => {
            const out = formatLogObject(log({ level: 40, msg: 'Watch out' }));
            expect(out).toContain('⚠️');
        });

        it('should use info emoji for level 30', () => {
            const out = formatLogObject(log({ level: 30, msg: 'Normal log' }));
            expect(out).toContain('ℹ️');
        });

        it('should use debug emoji for level 20', () => {
            const out = formatLogObject(log({ level: 20, msg: 'Debug info' }));
            expect(out).toContain('🔍');
        });

        it('should include module name in fallback', () => {
            const out = formatLogObject(log({ level: 30, module: 'telegram', msg: 'Bot started' }));
            expect(out).toContain('[telegram]');
            expect(out).toContain('Bot started');
        });
    });

    describe('timestamp', () => {
        it('should include HH:MM:SS timestamp', () => {
            const out = formatLogObject(log({ level: 30, msg: 'test' }));
            // Should match HH:MM:SS format
            expect(out).toMatch(/\d{2}:\d{2}:\d{2}/);
        });
    });
});
