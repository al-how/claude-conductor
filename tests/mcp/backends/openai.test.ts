import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.fn();
vi.mock('openai', () => ({
    default: vi.fn().mockImplementation(() => ({
        chat: {
            completions: {
                create: mockCreate,
            },
        },
    })),
}));

import { OpenAIBackend } from '../../../src/mcp/backends/openai.js';

describe('OpenAIBackend', () => {
    let backend: OpenAIBackend;

    beforeEach(() => {
        vi.clearAllMocks();
        backend = new OpenAIBackend('test-api-key', 'gpt-4o-mini');
    });

    describe('checkHealth', () => {
        it('should return true when API responds', async () => {
            mockCreate.mockResolvedValue({
                choices: [{ message: { content: 'pong' } }],
            });
            expect(await backend.checkHealth()).toBe(true);
        });

        it('should return false when API errors', async () => {
            mockCreate.mockRejectedValue(new Error('API error'));
            expect(await backend.checkHealth()).toBe(false);
        });
    });

    describe('generate', () => {
        it('should call chat completions with correct params', async () => {
            mockCreate.mockResolvedValue({
                choices: [{ message: { content: 'OpenAI response' } }],
                model: 'gpt-4o-mini',
                usage: { total_tokens: 150 },
            });

            const result = await backend.generate({
                prompt: 'Hello',
                systemPrompt: 'Be helpful',
                maxTokens: 2048,
                temperature: 0.5,
            });

            expect(result.text).toBe('OpenAI response');
            expect(result.model).toBe('gpt-4o-mini');
            expect(result.tokensUsed).toBe(150);

            expect(mockCreate).toHaveBeenCalledWith(
                {
                    model: 'gpt-4o-mini',
                    messages: [
                        { role: 'system', content: 'Be helpful' },
                        { role: 'user', content: 'Hello' },
                    ],
                    max_tokens: 2048,
                    temperature: 0.5,
                },
                { timeout: 30_000 },
            );
        });

        it('should omit system message when no systemPrompt', async () => {
            mockCreate.mockResolvedValue({
                choices: [{ message: { content: 'response' } }],
                model: 'gpt-4o-mini',
                usage: { total_tokens: 50 },
            });

            await backend.generate({ prompt: 'Hello' });

            expect(mockCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    messages: [{ role: 'user', content: 'Hello' }],
                }),
                expect.anything(),
            );
        });

        it('should handle empty response', async () => {
            mockCreate.mockResolvedValue({
                choices: [{ message: { content: null } }],
                model: 'gpt-4o-mini',
                usage: {},
            });

            const result = await backend.generate({ prompt: 'Hello' });
            expect(result.text).toBe('');
        });
    });
});
