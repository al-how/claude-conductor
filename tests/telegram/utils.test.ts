import { describe, it, expect } from 'vitest';
import { chunkMessage, markdownToTelegramHtml } from '../../src/telegram/utils.js';

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

describe('markdownToTelegramHtml', () => {
    it('should convert bold', () => {
        expect(markdownToTelegramHtml('**hello**')).toBe('<b>hello</b>');
    });

    it('should convert italic', () => {
        expect(markdownToTelegramHtml('*hello*')).toBe('<i>hello</i>');
    });

    it('should convert inline code', () => {
        expect(markdownToTelegramHtml('use `npm install`')).toBe('use <code>npm install</code>');
    });

    it('should convert code blocks', () => {
        const input = '```js\nconsole.log("hi");\n```';
        const result = markdownToTelegramHtml(input);
        expect(result).toBe('<pre><code class="language-js">console.log("hi");</code></pre>');
    });

    it('should convert links', () => {
        expect(markdownToTelegramHtml('[click](https://example.com)'))
            .toBe('<a href="https://example.com">click</a>');
    });

    it('should convert headers to bold', () => {
        expect(markdownToTelegramHtml('## Summary')).toBe('<b>Summary</b>');
    });

    it('should convert strikethrough', () => {
        expect(markdownToTelegramHtml('~~removed~~')).toBe('<s>removed</s>');
    });

    it('should escape HTML entities in plain text', () => {
        expect(markdownToTelegramHtml('x < y & z > w')).toBe('x &lt; y &amp; z &gt; w');
    });

    it('should not process markdown inside code blocks', () => {
        const input = '```\n**not bold**\n```';
        const result = markdownToTelegramHtml(input);
        expect(result).toContain('**not bold**');
        expect(result).not.toContain('<b>');
    });

    it('should handle mixed content', () => {
        const input = '**Bold** and *italic* with `code`';
        const result = markdownToTelegramHtml(input);
        expect(result).toBe('<b>Bold</b> and <i>italic</i> with <code>code</code>');
    });

    it('should convert blockquotes', () => {
        expect(markdownToTelegramHtml('> quoted text')).toBe('<blockquote>quoted text</blockquote>');
    });
});
