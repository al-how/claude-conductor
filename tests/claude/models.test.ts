import { describe, it, expect } from 'vitest';
import { resolveModel, resolveExecutionTarget } from '../../src/claude/models.js';
import type { OllamaConfig, OpenRouterConfig } from '../../src/config/schema.js';

describe('resolveModel (legacy)', () => {
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

const ollamaConfig: OllamaConfig = {
    base_url: 'http://localhost:11434',
    allowed_models: ['qwen3-coder', 'llama3'],
    default_model: 'qwen3-coder',
};

const openRouterConfig: OpenRouterConfig = {
    api_key: 'sk-or-test',
    base_url: 'https://openrouter.ai/api',
    allowed_models: ['qwen/qwen3-coder', 'meta-llama/llama-3.1-8b-instruct'],
    default_model: 'qwen/qwen3-coder',
};

describe('resolveExecutionTarget — Claude provider', () => {
    it('defaults to claude when provider is unset', () => {
        const t = resolveExecutionTarget({});
        expect(t.provider).toBe('claude');
        expect(t.model).toBeUndefined();
        expect(t.providerEnv).toBeUndefined();
    });

    it('resolves Claude alias', () => {
        const t = resolveExecutionTarget({ model: 'sonnet' });
        expect(t).toEqual({ provider: 'claude', model: 'claude-sonnet-4-6' });
    });

    it('passes through full Claude model ID', () => {
        const t = resolveExecutionTarget({ model: 'claude-opus-4-6' });
        expect(t).toEqual({ provider: 'claude', model: 'claude-opus-4-6' });
    });

    it('falls back to globalModel when no per-task model', () => {
        const t = resolveExecutionTarget({ globalModel: 'haiku' });
        expect(t).toEqual({ provider: 'claude', model: 'claude-haiku-4-5-20251001' });
    });

    it('per-task model takes precedence over globalModel', () => {
        const t = resolveExecutionTarget({ model: 'sonnet', globalModel: 'haiku' });
        expect(t).toEqual({ provider: 'claude', model: 'claude-sonnet-4-6' });
    });

    it('does not inject providerEnv', () => {
        const t = resolveExecutionTarget({ provider: 'claude', model: 'sonnet' });
        expect(t.providerEnv).toBeUndefined();
    });
});

describe('resolveExecutionTarget — ollama: prefix backward compat', () => {
    it('auto-detects ollama provider from model prefix when provider is unset', () => {
        const t = resolveExecutionTarget({ model: 'ollama:qwen3-coder', ollamaConfig });
        expect(t.provider).toBe('ollama');
        expect(t.model).toBe('qwen3-coder');
    });

    it('does NOT override explicit provider with ollama: prefix', () => {
        // Explicit provider: 'claude' must not be overridden by model prefix
        expect(() =>
            resolveExecutionTarget({ provider: 'claude', model: 'ollama:qwen3-coder' })
        ).not.toThrow();
        const t = resolveExecutionTarget({ provider: 'claude', model: 'ollama:qwen3-coder' });
        expect(t.provider).toBe('claude');
    });
});

describe('resolveExecutionTarget — Ollama provider', () => {
    it('throws when ollamaConfig is missing', () => {
        expect(() => resolveExecutionTarget({ provider: 'ollama', model: 'qwen3-coder' }))
            .toThrow('ollama config');
    });

    it('resolves model from config', () => {
        const t = resolveExecutionTarget({ provider: 'ollama', model: 'qwen3-coder', ollamaConfig });
        expect(t.provider).toBe('ollama');
        expect(t.model).toBe('qwen3-coder');
    });

    it('falls back to default_model when no model specified', () => {
        const t = resolveExecutionTarget({ provider: 'ollama', ollamaConfig });
        expect(t.model).toBe('qwen3-coder');
    });

    it('throws when no model and no default_model', () => {
        const cfg: OllamaConfig = { ...ollamaConfig, default_model: undefined };
        expect(() => resolveExecutionTarget({ provider: 'ollama', ollamaConfig: cfg }))
            .toThrow('requires a model');
    });

    it('throws on model not in allowlist', () => {
        expect(() =>
            resolveExecutionTarget({ provider: 'ollama', model: 'unlisted-model', ollamaConfig })
        ).toThrow('not in the Ollama allowed_models list');
    });

    it('injects correct provider env vars', () => {
        const t = resolveExecutionTarget({ provider: 'ollama', model: 'qwen3-coder', ollamaConfig });
        expect(t.providerEnv).toEqual({
            ANTHROPIC_BASE_URL: 'http://localhost:11434',
            ANTHROPIC_AUTH_TOKEN: 'ollama',
            ANTHROPIC_API_KEY: '',
        });
    });

    it('strips ollama: prefix from model string', () => {
        const t = resolveExecutionTarget({ model: 'ollama:qwen3-coder', ollamaConfig });
        expect(t.model).toBe('qwen3-coder');
    });

    it('does not use globalModel as fallback', () => {
        const cfg: OllamaConfig = { ...ollamaConfig, default_model: undefined };
        expect(() =>
            resolveExecutionTarget({ provider: 'ollama', globalModel: 'sonnet', ollamaConfig: cfg })
        ).toThrow('requires a model');
    });
});

describe('resolveExecutionTarget — OpenRouter provider', () => {
    it('throws when openRouterConfig is missing', () => {
        expect(() =>
            resolveExecutionTarget({ provider: 'openrouter', model: 'qwen/qwen3-coder' })
        ).toThrow('openrouter config');
    });

    it('resolves allowlisted model', () => {
        const t = resolveExecutionTarget({
            provider: 'openrouter',
            model: 'qwen/qwen3-coder',
            openRouterConfig,
        });
        expect(t.provider).toBe('openrouter');
        expect(t.model).toBe('qwen/qwen3-coder');
    });

    it('falls back to default_model when no model specified', () => {
        const t = resolveExecutionTarget({ provider: 'openrouter', openRouterConfig });
        expect(t.model).toBe('qwen/qwen3-coder');
    });

    it('throws when no model and no default_model', () => {
        const cfg: OpenRouterConfig = { ...openRouterConfig, default_model: undefined };
        expect(() => resolveExecutionTarget({ provider: 'openrouter', openRouterConfig: cfg }))
            .toThrow('requires a model');
    });

    it('throws on model not in allowlist', () => {
        expect(() =>
            resolveExecutionTarget({
                provider: 'openrouter',
                model: 'unlisted/model',
                openRouterConfig,
            })
        ).toThrow('not in the OpenRouter allowed_models list');
    });

    it('injects correct provider env vars', () => {
        const t = resolveExecutionTarget({
            provider: 'openrouter',
            model: 'qwen/qwen3-coder',
            openRouterConfig,
        });
        expect(t.providerEnv).toEqual({
            ANTHROPIC_BASE_URL: 'https://openrouter.ai/api',
            ANTHROPIC_AUTH_TOKEN: 'sk-or-test',
            ANTHROPIC_API_KEY: '',
        });
    });

    it('does not use globalModel as fallback', () => {
        const cfg: OpenRouterConfig = { ...openRouterConfig, default_model: undefined };
        expect(() =>
            resolveExecutionTarget({
                provider: 'openrouter',
                globalModel: 'sonnet',
                openRouterConfig: cfg,
            })
        ).toThrow('requires a model');
    });
});
