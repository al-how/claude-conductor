import { describe, it, expect, vi } from 'vitest';
import { buildClaudeArgs, parseClaudeOutput, type ClaudeResult } from '../../src/claude/invoke.js';

describe('buildClaudeArgs', () => {
    it('should build basic args with prompt', () => {
        const args = buildClaudeArgs({ prompt: 'hello' });
        expect(args).toContain('-p');
        expect(args).toContain('hello');
        expect(args).toContain('--output-format');
        expect(args).toContain('json');
        expect(args).toContain('--max-turns');
        expect(args).toContain('25');
    });

    it('should include --session-id when provided', () => {
        const args = buildClaudeArgs({ prompt: 'hi', sessionId: 'abc-123' });
        expect(args).toContain('--session-id');
        expect(args).toContain('abc-123');
    });

    it('should include --resume when true', () => {
        const args = buildClaudeArgs({ prompt: 'hi', resume: true });
        expect(args).toContain('--resume');
    });

    it('should include --allowedTools as space-separated values', () => {
        const args = buildClaudeArgs({ prompt: 'hi', allowedTools: ['Read', 'Glob', 'Grep'] });
        expect(args).toContain('--allowedTools');
        // Each tool is a separate arg after --allowedTools
        const idx = args.indexOf('--allowedTools');
        expect(args[idx + 1]).toBe('Read');
        expect(args[idx + 2]).toBe('Glob');
        expect(args[idx + 3]).toBe('Grep');
    });

    it('should include --dangerously-skip-permissions when true', () => {
        const args = buildClaudeArgs({ prompt: 'hi', dangerouslySkipPermissions: true });
        expect(args).toContain('--dangerously-skip-permissions');
    });

    it('should include --no-session-persistence when true', () => {
        const args = buildClaudeArgs({ prompt: 'hi', noSessionPersistence: true });
        expect(args).toContain('--no-session-persistence');
    });

    it('should include --append-system-prompt when provided', () => {
        const args = buildClaudeArgs({ prompt: 'hi', appendSystemPrompt: 'extra context' });
        expect(args).toContain('--append-system-prompt');
        expect(args).toContain('extra context');
    });

    it('should respect custom maxTurns', () => {
        const args = buildClaudeArgs({ prompt: 'hi', maxTurns: 10 });
        const idx = args.indexOf('--max-turns');
        expect(args[idx + 1]).toBe('10');
    });
});

describe('parseClaudeOutput', () => {
    it('should parse valid JSON stdout', () => {
        const result: ClaudeResult = { exitCode: 0, stdout: '{"result":"ok"}', stderr: '', timedOut: false };
        expect(parseClaudeOutput(result)).toEqual({ result: 'ok' });
    });

    it('should return null for non-zero exit code', () => {
        const result: ClaudeResult = { exitCode: 1, stdout: '{"x":1}', stderr: 'err', timedOut: false };
        expect(parseClaudeOutput(result)).toBeNull();
    });

    it('should return null for invalid JSON', () => {
        const result: ClaudeResult = { exitCode: 0, stdout: 'not json', stderr: '', timedOut: false };
        expect(parseClaudeOutput(result)).toBeNull();
    });

    it('should return null on timeout', () => {
        const result: ClaudeResult = { exitCode: -1, stdout: '', stderr: '', timedOut: true };
        expect(parseClaudeOutput(result)).toBeNull();
    });
});
