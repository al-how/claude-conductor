import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Logger } from 'pino';

// Mock the SDK before importing the module under test
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
    query: vi.fn()
}));

import { invokeApi } from '../../src/claude/invoke-api.js';
import { query } from '@anthropic-ai/claude-agent-sdk';

const mockQuery = query as ReturnType<typeof vi.fn>;

const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
} as unknown as Logger;

function createAsyncIterable<T>(items: T[]): AsyncIterable<T> {
    return {
        [Symbol.asyncIterator]() {
            let i = 0;
            return {
                async next() {
                    if (i < items.length) return { value: items[i++], done: false };
                    return { value: undefined as any, done: true };
                }
            };
        }
    };
}

describe('invokeApi', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return text, numTurns, and costUsd on success', async () => {
        mockQuery.mockReturnValue(createAsyncIterable([
            {
                type: 'result',
                subtype: 'success',
                result: 'Hello from the API',
                num_turns: 3,
                total_cost_usd: 0.05,
            }
        ]));

        const result = await invokeApi({
            prompt: 'test prompt',
            workingDir: '/vault',
            logger: mockLogger,
        });

        expect(result.text).toBe('Hello from the API');
        expect(result.numTurns).toBe(3);
        expect(result.costUsd).toBe(0.05);
        expect(result.error).toBeUndefined();
    });

    it('should return error string and partial text from error result', async () => {
        mockQuery.mockReturnValue(createAsyncIterable([
            {
                type: 'result',
                subtype: 'error_max_turns',
                errors: ['Partial output line 1', 'Partial output line 2'],
                num_turns: 25,
                total_cost_usd: 0.10,
            }
        ]));

        const result = await invokeApi({
            prompt: 'test prompt',
            workingDir: '/vault',
            logger: mockLogger,
        });

        expect(result.error).toBe('error_max_turns');
        expect(result.text).toBe('Partial output line 1\nPartial output line 2');
        expect(result.numTurns).toBe(25);
        expect(result.costUsd).toBe(0.10);
    });

    it('should return empty text when no result event is emitted', async () => {
        mockQuery.mockReturnValue(createAsyncIterable([
            { type: 'assistant', content: 'thinking...' }
        ]));

        const result = await invokeApi({
            prompt: 'test prompt',
            workingDir: '/vault',
            logger: mockLogger,
        });

        expect(result.text).toBe('');
        expect(result.numTurns).toBe(0);
        expect(result.costUsd).toBe(0);
        expect(result.error).toBeUndefined();
    });

    it('should pass AbortController to query options', async () => {
        mockQuery.mockReturnValue(createAsyncIterable([
            {
                type: 'result',
                subtype: 'success',
                result: 'done',
                num_turns: 1,
                total_cost_usd: 0.01,
            }
        ]));

        await invokeApi({
            prompt: 'test prompt',
            workingDir: '/vault',
            logger: mockLogger,
            timeoutMs: 60_000,
        });

        expect(mockQuery).toHaveBeenCalledWith(
            expect.objectContaining({
                options: expect.objectContaining({
                    abortController: expect.any(AbortController),
                })
            })
        );
    });

    it('should clean up timer even on error', async () => {
        mockQuery.mockReturnValue({
            [Symbol.asyncIterator]() {
                return {
                    async next() {
                        throw new Error('SDK failure');
                    }
                };
            }
        });

        await expect(invokeApi({
            prompt: 'test prompt',
            workingDir: '/vault',
            logger: mockLogger,
        })).rejects.toThrow('SDK failure');
    });
});
