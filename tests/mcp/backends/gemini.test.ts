import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the @google/genai module
const mockGenerateContent = vi.fn();
vi.mock('@google/genai', () => ({
    GoogleGenAI: vi.fn().mockImplementation(() => ({
        models: {
            generateContent: mockGenerateContent,
        },
    })),
}));

import { GeminiBackend } from '../../../src/mcp/backends/gemini.js';

describe('GeminiBackend', () => {
    let backend: GeminiBackend;

    beforeEach(() => {
        vi.clearAllMocks();
        backend = new GeminiBackend('test-api-key', 'gemini-2.0-flash');
    });

    describe('checkHealth', () => {
        it('should return true when API responds', async () => {
            mockGenerateContent.mockResolvedValue({ text: 'pong' });
            expect(await backend.checkHealth()).toBe(true);
        });

        it('should return false when API errors', async () => {
            mockGenerateContent.mockRejectedValue(new Error('API error'));
            expect(await backend.checkHealth()).toBe(false);
        });
    });

    describe('generate', () => {
        it('should call generateContent with correct params', async () => {
            mockGenerateContent.mockResolvedValue({
                text: 'Generated response',
                usageMetadata: { totalTokenCount: 100 },
            });

            const result = await backend.generate({
                prompt: 'Hello',
                systemPrompt: 'Be helpful',
                maxTokens: 2048,
                temperature: 0.5,
            });

            expect(result.text).toBe('Generated response');
            expect(result.model).toBe('gemini-2.0-flash');
            expect(result.tokensUsed).toBe(100);

            expect(mockGenerateContent).toHaveBeenCalledWith({
                model: 'gemini-2.0-flash',
                contents: 'Hello',
                config: {
                    maxOutputTokens: 2048,
                    temperature: 0.5,
                    systemInstruction: 'Be helpful',
                },
            });
        });

        it('should handle empty text response', async () => {
            mockGenerateContent.mockResolvedValue({
                text: null,
                usageMetadata: {},
            });

            const result = await backend.generate({ prompt: 'Hello' });
            expect(result.text).toBe('');
        });
    });

    describe('generateWithSearch', () => {
        it('should include googleSearch tool', async () => {
            mockGenerateContent.mockResolvedValue({
                text: 'Search results',
                usageMetadata: { totalTokenCount: 200 },
            });

            const result = await backend.generateWithSearch('latest news');

            expect(result.text).toBe('Search results');
            expect(mockGenerateContent).toHaveBeenCalledWith(
                expect.objectContaining({
                    config: expect.objectContaining({
                        tools: [{ googleSearch: {} }],
                    }),
                }),
            );
        });
    });
});
