import { describe, it, expect } from 'vitest';
import { isStopWord } from '../../src/voice/stop-words.js';

const STOP_WORDS = ['stop', 'goodbye', 'end chat', 'bye'];

describe('isStopWord', () => {
    it('matches "stop" alone', () => {
        expect(isStopWord('stop', STOP_WORDS)).toBe(true);
    });

    it('matches "Bye." (case + punctuation)', () => {
        expect(isStopWord('Bye.', STOP_WORDS)).toBe(true);
    });

    it('matches "goodbye claude"', () => {
        expect(isStopWord('goodbye claude', STOP_WORDS)).toBe(true);
    });

    it('matches "ok stop"', () => {
        expect(isStopWord('ok stop', STOP_WORDS)).toBe(true);
    });

    it('matches multi-word phrase "end chat"', () => {
        expect(isStopWord('end chat', STOP_WORDS)).toBe(true);
    });

    it('does NOT match "please stop the recording" (4 words)', () => {
        expect(isStopWord('please stop the recording', STOP_WORDS)).toBe(false);
    });

    it('does NOT match "stop trying to fix the bug" (6 words)', () => {
        expect(isStopWord('stop trying to fix the bug', STOP_WORDS)).toBe(false);
    });

    it('does NOT match empty string', () => {
        expect(isStopWord('', STOP_WORDS)).toBe(false);
    });

    it('does NOT match whitespace-only', () => {
        expect(isStopWord('   ', STOP_WORDS)).toBe(false);
    });

    it('does NOT match unrelated content', () => {
        expect(isStopWord('what is the weather today', STOP_WORDS)).toBe(false);
    });

    it('matches case-insensitively', () => {
        expect(isStopWord('STOP', STOP_WORDS)).toBe(true);
        expect(isStopWord('Goodbye Claude', STOP_WORDS)).toBe(true);
    });
});
