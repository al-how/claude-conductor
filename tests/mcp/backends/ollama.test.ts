import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OllamaBackend } from '../../../src/mcp/backends/ollama.js';

describe('OllamaBackend', () => {
    let backend: OllamaBackend;
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        backend = new OllamaBackend('http://localhost:11434', 'qwen3-vl:8b');
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    describe('checkHealth', () => {
        it('should return true when Ollama responds', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
            expect(await backend.checkHealth()).toBe(true);
            expect(globalThis.fetch).toHaveBeenCalledWith(
                'http://localhost:11434/api/tags',
                expect.objectContaining({ signal: expect.any(AbortSignal) }),
            );
        });

        it('should return false when Ollama is unreachable', async () => {
            globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
            expect(await backend.checkHealth()).toBe(false);
        });
    });

    describe('generate', () => {
        it('should call Ollama API with correct params', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    response: 'Ollama response',
                    model: 'qwen3-vl:8b',
                    eval_count: 50,
                    prompt_eval_count: 20,
                }),
            });

            const result = await backend.generate({
                prompt: 'Hello',
                systemPrompt: 'Be helpful',
                timeoutMs: 10_000,
            });

            expect(result.text).toBe('Ollama response');
            expect(result.model).toBe('qwen3-vl:8b');
            expect(result.tokensUsed).toBe(70);

            const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
            expect(call[0]).toBe('http://localhost:11434/api/generate');
            const body = JSON.parse(call[1].body);
            expect(body.model).toBe('qwen3-vl:8b');
            expect(body.prompt).toBe('Hello');
            expect(body.system).toBe('Be helpful');
            expect(body.stream).toBe(false);
        });

        it('should throw on non-ok response', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 500,
                text: async () => 'Internal error',
            });

            await expect(backend.generate({ prompt: 'Hello' })).rejects.toThrow('Ollama API error 500');
        });
    });

    describe('analyzeImage', () => {
        it('should send image as base64', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    response: 'I see a cat',
                    model: 'qwen3-vl:8b',
                    eval_count: 30,
                    prompt_eval_count: 100,
                }),
            });

            const result = await backend.analyzeImage({
                imageBase64: 'aGVsbG8=',
                mimeType: 'image/png',
                prompt: 'What is this?',
            });

            expect(result.text).toBe('I see a cat');

            const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
            const body = JSON.parse(call[1].body);
            expect(body.images).toEqual(['aGVsbG8=']);
        });
    });

    describe('trailing slash handling', () => {
        it('should strip trailing slash from host', async () => {
            const b = new OllamaBackend('http://localhost:11434/', 'qwen3-vl:8b');
            globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
            await b.checkHealth();
            expect(globalThis.fetch).toHaveBeenCalledWith(
                'http://localhost:11434/api/tags',
                expect.anything(),
            );
        });
    });
});
