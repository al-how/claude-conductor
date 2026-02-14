import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLogger } from '../src/logger.js';

describe('createLogger', () => {
    const origLogFormat = process.env.LOG_FORMAT;

    beforeEach(() => {
        process.env.LOG_FORMAT = 'json';
    });

    afterEach(() => {
        if (origLogFormat === undefined) {
            delete process.env.LOG_FORMAT;
        } else {
            process.env.LOG_FORMAT = origLogFormat;
        }
    });

    it('should create a logger with default level info', () => {
        const log = createLogger();
        expect(log.level).toBe('info');
    });

    it('should accept custom level', () => {
        const log = createLogger({ level: 'debug' });
        expect(log.level).toBe('debug');
    });

    it('should create child loggers', () => {
        const log = createLogger();
        const child = log.child({ component: 'test' });
        expect(child).toBeDefined();
        expect(child.bindings()).toHaveProperty('component', 'test');
    });
});
