import { describe, it, expect, vi, beforeEach } from 'vitest';
import { researchWeb } from '../../../src/mcp/tools/research-web.js';
import type { GeminiBackend } from '../../../src/mcp/backends/gemini.js';
import pino from 'pino';

const logger = pino({ level: 'silent' });

describe('researchWeb', () => {
    let mockGemini: GeminiBackend;

    beforeEach(() => {
        mockGemini = {
            name: 'gemini',
            generateWithSearch: vi.fn(),
            generate: vi.fn(),
            checkHealth: vi.fn(),
        } as unknown as GeminiBackend;
    });

    it('should call generateWithSearch with the query', async () => {
        (mockGemini.generateWithSearch as ReturnType<typeof vi.fn>).mockResolvedValue({
            text: 'Research findings',
            model: 'gemini-2.0-flash',
            tokensUsed: 200,
        });

        const result = await researchWeb({ query: 'latest AI news' }, mockGemini, logger);

        expect(result).toBe('Research findings');
        expect(mockGemini.generateWithSearch).toHaveBeenCalledWith(
            'latest AI news',
            expect.objectContaining({ timeoutMs: 60_000 }),
        );
    });

    it('should use thorough system prompt when depth is thorough', async () => {
        (mockGemini.generateWithSearch as ReturnType<typeof vi.fn>).mockResolvedValue({
            text: 'Detailed findings',
            model: 'gemini-2.0-flash',
        });

        await researchWeb({ query: 'topic', depth: 'thorough' }, mockGemini, logger);

        const call = (mockGemini.generateWithSearch as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(call[1].systemPrompt).toContain('thorough');
    });

    it('should return fallback error on failure', async () => {
        (mockGemini.generateWithSearch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('API down'));

        const result = await researchWeb({ query: 'test' }, mockGemini, logger);
        const parsed = JSON.parse(result);

        expect(parsed.error).toBe(true);
        expect(parsed.suggestion).toContain('built-in tools');
    });
});
