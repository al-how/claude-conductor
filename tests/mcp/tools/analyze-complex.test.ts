import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analyzeComplex } from '../../../src/mcp/tools/analyze-complex.js';
import type { ModelBackend } from '../../../src/mcp/backends/types.js';
import pino from 'pino';

const logger = pino({ level: 'silent' });

function mockBackend(name: string): ModelBackend {
    return {
        name,
        checkHealth: vi.fn().mockResolvedValue(true),
        generate: vi.fn().mockResolvedValue({ text: `${name} analysis`, model: name }),
    };
}

describe('analyzeComplex', () => {
    let openai: ModelBackend;
    let gemini: ModelBackend;

    beforeEach(() => {
        openai = mockBackend('openai');
        gemini = mockBackend('gemini');
    });

    it('should use openai as primary', async () => {
        const result = await analyzeComplex(
            { content: 'Code here', question: 'Is this safe?' },
            { openai, gemini },
            logger,
        );

        expect(result).toBe('openai analysis');
        expect(openai.generate).toHaveBeenCalled();
        expect(gemini.generate).not.toHaveBeenCalled();
    });

    it('should fall back to gemini when openai fails', async () => {
        (openai.generate as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('API error'));

        const result = await analyzeComplex(
            { content: 'Code', question: 'Review' },
            { openai, gemini },
            logger,
        );

        expect(result).toBe('gemini analysis');
    });

    it('should return fallback error when no backends available', async () => {
        const result = await analyzeComplex(
            { content: 'Code', question: 'Review' },
            {},
            logger,
        );
        const parsed = JSON.parse(result);

        expect(parsed.error).toBe(true);
    });

    it('should include question and content in prompt', async () => {
        await analyzeComplex(
            { content: 'function foo() {}', question: 'Is this correct?' },
            { openai },
            logger,
        );

        const call = (openai.generate as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(call[0].prompt).toContain('Is this correct?');
        expect(call[0].prompt).toContain('function foo() {}');
    });
});
