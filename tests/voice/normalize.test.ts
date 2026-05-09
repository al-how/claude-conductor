import { describe, it, expect } from 'vitest';
import { normalizeForSpeech } from '../../src/voice/normalize.js';

describe('normalizeForSpeech', () => {
    it('strips fenced code blocks', () => {
        const input = 'Here is code:\n```ts\nconst x = 1;\n```\nDone.';
        const out = normalizeForSpeech(input, 1000);
        expect(out).not.toContain('```');
        expect(out).not.toContain('const x');
        expect(out).toMatch(/Here is code/);
        expect(out).toMatch(/Done/);
    });

    it('strips inline code backticks', () => {
        const out = normalizeForSpeech('Use the `foo()` function.', 1000);
        expect(out).toBe('Use the foo() function.');
    });

    it('strips bold and italic markers', () => {
        const out = normalizeForSpeech('This is **bold** and *italic* and __also bold__.', 1000);
        expect(out).toBe('This is bold and italic and also bold.');
    });

    it('strips heading markers', () => {
        const out = normalizeForSpeech('# Hello\n## World', 1000);
        expect(out).toMatch(/Hello/);
        expect(out).toMatch(/World/);
        expect(out).not.toContain('#');
    });

    it('strips list bullets', () => {
        const out = normalizeForSpeech('- one\n- two\n* three\n1. four', 1000);
        expect(out).not.toMatch(/^[-*]/m);
        expect(out).toMatch(/one/);
        expect(out).toMatch(/four/);
    });

    it('strips link syntax keeping label', () => {
        const out = normalizeForSpeech('See [the docs](https://example.com).', 1000);
        expect(out).toBe('See the docs.');
    });

    it('truncates at maxChars at a sentence boundary if possible', () => {
        const sentence = 'This is a sentence. ';
        const input = sentence.repeat(20);
        const out = normalizeForSpeech(input, 60);
        expect(out.length).toBeLessThanOrEqual(60);
        expect(out.endsWith('.')).toBe(true);
    });

    it('truncates hard if no sentence boundary near maxChars', () => {
        const out = normalizeForSpeech('a'.repeat(200), 50);
        expect(out.length).toBeLessThanOrEqual(50);
    });
});
