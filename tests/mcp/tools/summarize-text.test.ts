import { describe, it, expect, vi, beforeEach } from 'vitest';
import { summarizeText } from '../../../src/mcp/tools/summarize-text.js';
import type { ModelBackend } from '../../../src/mcp/backends/types.js';
import pino from 'pino';

const logger = pino({ level: 'silent' });

function mockBackend(name: string): ModelBackend {
    return {
        name,
        checkHealth: vi.fn().mockResolvedValue(true),
        generate: vi.fn().mockResolvedValue({ text: `${name} summary`, model: name }),
    };
}

describe('summarizeText', () => {
    let ollama: ModelBackend;
    let gemini: ModelBackend;
    let openai: ModelBackend;

    beforeEach(() => {
        ollama = mockBackend('ollama');
        gemini = mockBackend('gemini');
        openai = mockBackend('openai');
    });

    it('should use ollama as primary for short content', async () => {
        const result = await summarizeText(
            { content: 'Short text to summarize' },
            { ollama, gemini, openai },
            logger,
        );

        expect(result).toBe('ollama summary');
        expect(ollama.generate).toHaveBeenCalled();
        expect(gemini.generate).not.toHaveBeenCalled();
    });

    it('should fall back to gemini when ollama fails', async () => {
        (ollama.generate as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Ollama down'));

        const result = await summarizeText(
            { content: 'Text' },
            { ollama, gemini, openai },
            logger,
        );

        expect(result).toBe('gemini summary');
    });

    it('should skip ollama for content exceeding char limit', async () => {
        const longContent = 'x'.repeat(200_000);

        const result = await summarizeText(
            { content: longContent },
            { ollama, gemini, openai },
            logger,
        );

        expect(result).toBe('gemini summary');
        expect(ollama.generate).not.toHaveBeenCalled();
    });

    it('should pass focus to system prompt', async () => {
        await summarizeText(
            { content: 'Text', focus: 'key metrics' },
            { ollama },
            logger,
        );

        const call = (ollama.generate as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(call[0].systemPrompt).toContain('key metrics');
    });

    it('should return fallback error when no backends available', async () => {
        const result = await summarizeText({ content: 'Text' }, {}, logger);
        const parsed = JSON.parse(result);

        expect(parsed.error).toBe(true);
        expect(parsed.suggestion).toContain('built-in tools');
    });

    it('should return fallback error when all backends fail', async () => {
        (ollama.generate as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));
        (gemini.generate as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));
        (openai.generate as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));

        const result = await summarizeText(
            { content: 'Text' },
            { ollama, gemini, openai },
            logger,
        );
        const parsed = JSON.parse(result);

        expect(parsed.error).toBe(true);
    });
});
