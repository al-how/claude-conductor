import { describe, it, expect } from 'vitest';

describe('main module', () => {
    it('should export a main function', async () => {
        const mod = await import('../src/main.js');
        expect(typeof mod.main).toBe('function');
    });
});
