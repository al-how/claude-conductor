import { describe, it, expect } from 'vitest';
import { resolveModel, MODEL_ALIASES } from '../../src/claude/models.js';

describe('resolveModel', () => {
    it('should resolve "opus" to full model ID', () => {
        expect(resolveModel('opus')).toBe(MODEL_ALIASES.opus);
    });

    it('should resolve "sonnet" to full model ID', () => {
        expect(resolveModel('sonnet')).toBe(MODEL_ALIASES.sonnet);
    });

    it('should resolve "haiku" to full model ID', () => {
        expect(resolveModel('haiku')).toBe(MODEL_ALIASES.haiku);
    });

    it('should pass through full model IDs unchanged', () => {
        expect(resolveModel('claude-opus-4-5-20250514')).toBe('claude-opus-4-5-20250514');
    });

    it('should pass through unknown strings unchanged', () => {
        expect(resolveModel('some-custom-model')).toBe('some-custom-model');
    });

    it('should return undefined for undefined input', () => {
        expect(resolveModel(undefined)).toBeUndefined();
    });

    it('should be case-insensitive for aliases', () => {
        expect(resolveModel('Sonnet')).toBe(MODEL_ALIASES.sonnet);
        expect(resolveModel('OPUS')).toBe(MODEL_ALIASES.opus);
    });
});
