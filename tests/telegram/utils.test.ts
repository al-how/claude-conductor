import { describe, it, expect } from 'vitest';
import { chunkMessage, sanitizeMarkdown } from '../../src/telegram/utils.js';

describe('chunkMessage', () => {
    it('should return single chunk if within limit', () => {
        const text = 'hello';
        expect(chunkMessage(text, 10)).toEqual(['hello']);
    });

    it('should split long text', () => {
        const text = 'hello world';
        expect(chunkMessage(text, 6)).toEqual(['hello ', 'world']);
    });

    it('should split extremely long lines', () => {
        const text = 'abcdefghij';
        expect(chunkMessage(text, 5)).toEqual(['abcde', 'fghij']);
    });
});

describe('sanitizeMarkdown', () => {
    it('should escape special characters', () => {
        const text = 'Hello_World. [Test]';
        const expected = 'Hello\\_World\\. \\[Test\\]';
        expect(sanitizeMarkdown(text)).toBe(expected);
    });
});
