import { describe, it, expect, vi, beforeEach } from 'vitest';
import { summarizeUrl } from '../../../src/mcp/tools/summarize-url.js';
import type { GeminiBackend } from '../../../src/mcp/backends/gemini.js';
import pino from 'pino';

vi.mock('../../../src/mcp/utils/fetch-url.js', () => ({
    fetchAndExtract: vi.fn().mockResolvedValue({
        title: 'Test Article',
        content: 'Article content here',
        url: 'https://example.com',
        byline: 'Author Name',
    }),
}));

const logger = pino({ level: 'silent' });

describe('summarizeUrl', () => {
    let mockGemini: GeminiBackend;

    beforeEach(() => {
        vi.clearAllMocks();
        mockGemini = {
            name: 'gemini',
            generate: vi.fn().mockResolvedValue({
                text: 'URL summary',
                model: 'gemini-2.0-flash',
                tokensUsed: 100,
            }),
            generateWithSearch: vi.fn(),
            checkHealth: vi.fn(),
        } as unknown as GeminiBackend;
    });

    it('should fetch URL and summarize with gemini', async () => {
        const result = await summarizeUrl(
            { url: 'https://example.com' },
            mockGemini,
            logger,
        );

        expect(result).toBe('URL summary');
        expect(mockGemini.generate).toHaveBeenCalledWith(
            expect.objectContaining({
                prompt: expect.stringContaining('Test Article'),
            }),
        );
    });

    it('should include byline in prompt', async () => {
        await summarizeUrl({ url: 'https://example.com' }, mockGemini, logger);

        const call = (mockGemini.generate as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(call[0].prompt).toContain('Author Name');
    });

    it('should include focus in system prompt', async () => {
        await summarizeUrl(
            { url: 'https://example.com', focus: 'technical details' },
            mockGemini,
            logger,
        );

        const call = (mockGemini.generate as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(call[0].systemPrompt).toContain('technical details');
    });

    it('should return fallback error on failure', async () => {
        (mockGemini.generate as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('API down'));

        const result = await summarizeUrl({ url: 'https://example.com' }, mockGemini, logger);
        const parsed = JSON.parse(result);

        expect(parsed.error).toBe(true);
    });
});
