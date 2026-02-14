import { describe, it, expect, vi } from 'vitest';
import { buildClaudeArgs, parseClaudeOutput, extractResponseText, type ClaudeResult } from '../../src/claude/invoke.js';

describe('buildClaudeArgs', () => {
    it('should build basic args with prompt and default to stream-json', () => {
        const args = buildClaudeArgs({ prompt: 'hello' });
        expect(args).toContain('-p');
        expect(args).toContain('hello');
        expect(args).toContain('--output-format');
        expect(args).toContain('stream-json');
        expect(args).toContain('--max-turns');
        expect(args).toContain('25');
    });

    it('should use json output format when explicitly specified', () => {
        const args = buildClaudeArgs({ prompt: 'hello', outputFormat: 'json' });
        expect(args).toContain('--output-format');
        expect(args).toContain('json');
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

describe('extractResponseText', () => {
    it('should return result field from JSON', () => {
        const result: ClaudeResult = { exitCode: 0, stdout: '{"result":"hello"}', stderr: '', timedOut: false };
        expect(extractResponseText(result)).toBe('hello');
    });

    it('should return text field when result is absent', () => {
        const result: ClaudeResult = { exitCode: 0, stdout: '{"text":"world"}', stderr: '', timedOut: false };
        expect(extractResponseText(result)).toBe('world');
    });

    it('should return friendly message for error_max_turns', () => {
        const stdout = JSON.stringify({
            type: 'result',
            subtype: 'error_max_turns',
            is_error: false,
            num_turns: 26,
        });
        const result: ClaudeResult = { exitCode: 0, stdout, stderr: '', timedOut: false };
        const text = extractResponseText(result);
        expect(text).toContain('ran out of turns');
        expect(text).toContain('26');
    });

    it('should return generic message for result JSON with no text', () => {
        const stdout = JSON.stringify({ type: 'result', subtype: 'some_other_reason' });
        const result: ClaudeResult = { exitCode: 0, stdout, stderr: '', timedOut: false };
        expect(extractResponseText(result)).toContain('finished without a response');
        expect(extractResponseText(result)).toContain('some_other_reason');
    });

    it('should return timeout message when timed out', () => {
        const result: ClaudeResult = { exitCode: -1, stdout: '', stderr: '', timedOut: true };
        expect(extractResponseText(result)).toBe('Claude Code timed out.');
    });

    it('should return error message with stderr for non-zero exit', () => {
        const result: ClaudeResult = { exitCode: 1, stdout: '', stderr: 'something broke', timedOut: false };
        const text = extractResponseText(result);
        expect(text).toContain('exited with code 1');
        expect(text).toContain('something broke');
    });

    it('should return raw stdout for non-JSON output', () => {
        const result: ClaudeResult = { exitCode: 0, stdout: 'plain text response', stderr: '', timedOut: false };
        expect(extractResponseText(result)).toBe('plain text response');
    });

    it('should return (empty response) for empty stdout', () => {
        const result: ClaudeResult = { exitCode: 0, stdout: '', stderr: '', timedOut: false };
        expect(extractResponseText(result)).toBe('(empty response)');
    });
});

describe('stream-json result reconstruction', () => {
    it('should produce backward-compatible JSON from a stream-json result event', () => {
        // Simulates what invokeClaude does when it gets a result event from stream-json
        const resultEvent = {
            type: 'result',
            result: 'Hello, world!',
            text: 'Hello, world!',
            num_turns: 3,
        };

        // Reconstruct as invokeClaude does
        const compat: Record<string, unknown> = {
            type: resultEvent.type,
            result: resultEvent.result ?? resultEvent.text,
            text: resultEvent.text ?? resultEvent.result,
            subtype: undefined,
            num_turns: resultEvent.num_turns,
        };
        for (const key of Object.keys(compat)) {
            if (compat[key] === undefined) delete compat[key];
        }
        const stdout = JSON.stringify(compat);

        const claudeResult: ClaudeResult = { exitCode: 0, stdout, stderr: '', timedOut: false, numTurns: 3 };
        expect(extractResponseText(claudeResult)).toBe('Hello, world!');
        expect(parseClaudeOutput(claudeResult)).toEqual({
            type: 'result',
            result: 'Hello, world!',
            text: 'Hello, world!',
            num_turns: 3,
        });
    });

    it('should produce backward-compatible JSON for max_turns error', () => {
        const resultEvent = {
            type: 'result',
            subtype: 'error_max_turns',
            num_turns: 25,
        };

        const compat: Record<string, unknown> = {
            type: resultEvent.type,
            subtype: resultEvent.subtype,
            num_turns: resultEvent.num_turns,
        };
        const stdout = JSON.stringify(compat);

        const claudeResult: ClaudeResult = { exitCode: 0, stdout, stderr: '', timedOut: false, numTurns: 25 };
        expect(extractResponseText(claudeResult)).toContain('ran out of turns');
        expect(extractResponseText(claudeResult)).toContain('25');
    });

    it('should include numTurns in ClaudeResult', () => {
        const result: ClaudeResult = { exitCode: 0, stdout: '{"result":"ok"}', stderr: '', timedOut: false, numTurns: 5 };
        expect(result.numTurns).toBe(5);
    });
});
