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
