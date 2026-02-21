import { describe, it, expect } from 'vitest';
import { resolveModel } from '../../src/claude/models.js';

describe('resolveModel', () => {
    it('should return undefined for undefined input', () => {
        expect(resolveModel(undefined)).toBeUndefined();
    });

    it('should resolve Claude alias to full model ID', () => {
        const result = resolveModel('sonnet');
        expect(result).toEqual({
            model: 'claude-sonnet-4-6',
            provider: 'claude',
        });
    });

    it('should pass through unknown Claude model IDs', () => {
        const result = resolveModel('claude-opus-4-5-20250514');
        expect(result).toEqual({
            model: 'claude-opus-4-5-20250514',
            provider: 'claude',
        });
    });

    it('should resolve ollama: prefixed model', () => {
        const result = resolveModel('ollama:qwen3-coder');
        expect(result).toEqual({
            model: 'qwen3-coder',
            provider: 'ollama',
        });
    });

    it('should resolve ollama: prefix case-insensitively', () => {
        const result = resolveModel('Ollama:llama3');
        expect(result).toEqual({
            model: 'llama3',
            provider: 'ollama',
        });
    });

    it('should be case-insensitive for Claude aliases', () => {
        expect(resolveModel('OPUS')).toEqual({
            model: 'claude-opus-4-6',
            provider: 'claude',
        });
    });
});
