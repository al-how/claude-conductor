import { describe, it, expect, afterEach } from 'vitest';
import { loadMcpConfig } from '../../src/mcp/config.js';

describe('loadMcpConfig', () => {
    const savedEnv: Record<string, string | undefined> = {};
    const envKeys = [
        'GEMINI_API_KEY', 'GEMINI_MODEL',
        'OPENAI_API_KEY', 'OPENAI_MODEL',
        'OLLAMA_HOST', 'OLLAMA_MODEL',
    ];

    afterEach(() => {
        for (const key of envKeys) {
            if (savedEnv[key] !== undefined) {
                process.env[key] = savedEnv[key];
            } else {
                delete process.env[key];
            }
        }
    });

    function setEnv(env: Record<string, string>) {
        for (const key of envKeys) {
            savedEnv[key] = process.env[key];
            delete process.env[key];
        }
        Object.assign(process.env, env);
    }

    it('should load defaults when no env vars set', () => {
        setEnv({});
        const config = loadMcpConfig();

        expect(config.geminiApiKey).toBeUndefined();
        expect(config.openaiApiKey).toBeUndefined();
        expect(config.ollamaHost).toBe('http://host.docker.internal:11434');
        expect(config.ollamaModel).toBe('qwen3-vl:8b');
        expect(config.geminiModel).toBe('gemini-2.0-flash');
        expect(config.openaiModel).toBe('gpt-4o-mini');
    });

    it('should load API keys from env vars', () => {
        setEnv({
            GEMINI_API_KEY: 'gemini-key',
            OPENAI_API_KEY: 'openai-key',
        });
        const config = loadMcpConfig();

        expect(config.geminiApiKey).toBe('gemini-key');
        expect(config.openaiApiKey).toBe('openai-key');
    });

    it('should load custom models from env vars', () => {
        setEnv({
            GEMINI_MODEL: 'gemini-pro',
            OPENAI_MODEL: 'gpt-4',
            OLLAMA_MODEL: 'llama3:70b',
            OLLAMA_HOST: 'http://my-host:11434',
        });
        const config = loadMcpConfig();

        expect(config.geminiModel).toBe('gemini-pro');
        expect(config.openaiModel).toBe('gpt-4');
        expect(config.ollamaModel).toBe('llama3:70b');
        expect(config.ollamaHost).toBe('http://my-host:11434');
    });
});
