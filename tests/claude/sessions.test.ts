import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listRecentSessions, formatRelativeTime } from '../../src/claude/sessions.js';

const VAULT = '/fake/vault';
const PROJECT_DIRNAME = '-fake-vault';

function makeUuid(seed: number): string {
    const hex = seed.toString(16).padStart(12, '0');
    return `00000000-0000-4000-8000-${hex}`;
}

function writeSession(
    projectDir: string,
    uuid: string,
    lines: string[],
    mtimeSeconds: number
) {
    const path = join(projectDir, `${uuid}.jsonl`);
    writeFileSync(path, lines.join('\n') + '\n');
    utimesSync(path, mtimeSeconds, mtimeSeconds);
    return path;
}

describe('listRecentSessions', () => {
    let claudeHome: string;
    let projectDir: string;

    beforeEach(() => {
        claudeHome = mkdtempSync(join(tmpdir(), 'sessions-test-'));
        projectDir = join(claudeHome, 'projects', PROJECT_DIRNAME);
        mkdirSync(projectDir, { recursive: true });
    });

    afterEach(() => {
        rmSync(claudeHome, { recursive: true, force: true });
    });

    it('sorts by mtime desc and reads first non-meta user line as preview', async () => {
        writeSession(projectDir, makeUuid(1), [
            JSON.stringify({ type: 'system', timestamp: '2026-05-01T00:00:00Z' }),
            JSON.stringify({ type: 'user', message: { content: 'oldest message' } }),
        ], 1000);

        writeSession(projectDir, makeUuid(2), [
            JSON.stringify({ type: 'user', message: { content: 'middle message' } }),
        ], 2000);

        writeSession(projectDir, makeUuid(3), [
            JSON.stringify({ type: 'user', message: { content: 'newest message' } }),
        ], 3000);

        const result = await listRecentSessions({ vaultPath: VAULT, claudeHome, limit: 10 });
        expect(result.map(r => r.preview)).toEqual([
            'newest message',
            'middle message',
            'oldest message',
        ]);
        expect(result[0].uuid).toBe(makeUuid(3));
    });

    it('skips meta and slash-command user messages, picks the first real prompt', async () => {
        writeSession(projectDir, makeUuid(1), [
            JSON.stringify({
                type: 'user',
                isMeta: true,
                message: { content: '<local-command-caveat>noise</local-command-caveat>' },
            }),
            JSON.stringify({
                type: 'user',
                message: { content: '<command-name>/model</command-name>\n<command-args>opus</command-args>' },
            }),
            JSON.stringify({
                type: 'user',
                message: { content: 'real user prompt' },
            }),
        ], 1000);

        const result = await listRecentSessions({ vaultPath: VAULT, claudeHome });
        expect(result).toHaveLength(1);
        expect(result[0].preview).toBe('real user prompt');
    });

    it('returns [] when project dir does not exist', async () => {
        const result = await listRecentSessions({
            vaultPath: '/nope/missing',
            claudeHome,
        });
        expect(result).toEqual([]);
    });

    it('ignores files whose name is not a UUID', async () => {
        writeSession(projectDir, makeUuid(1), [
            JSON.stringify({ type: 'user', message: { content: 'valid' } }),
        ], 1000);
        writeFileSync(join(projectDir, 'notes.jsonl'), '{}\n');
        writeFileSync(join(projectDir, 'README.md'), 'ignore me\n');

        const result = await listRecentSessions({ vaultPath: VAULT, claudeHome });
        expect(result).toHaveLength(1);
        expect(result[0].uuid).toBe(makeUuid(1));
    });

    it('respects the limit option', async () => {
        for (let i = 1; i <= 15; i++) {
            writeSession(projectDir, makeUuid(i), [
                JSON.stringify({ type: 'user', message: { content: `msg ${i}` } }),
            ], 1000 + i);
        }

        const result = await listRecentSessions({ vaultPath: VAULT, claudeHome, limit: 10 });
        expect(result).toHaveLength(10);
        expect(result[0].preview).toBe('msg 15');
        expect(result[9].preview).toBe('msg 6');
    });

    it('falls back to "(no user message)" when no usable user line found', async () => {
        writeSession(projectDir, makeUuid(1), [
            JSON.stringify({ type: 'system', timestamp: '2026-05-01T00:00:00Z' }),
            JSON.stringify({ type: 'assistant', message: { content: 'hi' } }),
        ], 1000);

        const result = await listRecentSessions({ vaultPath: VAULT, claudeHome });
        expect(result[0].preview).toBe('(no user message)');
    });

    it('truncates long previews and collapses whitespace', async () => {
        const longText = 'x'.repeat(200);
        writeSession(projectDir, makeUuid(1), [
            JSON.stringify({ type: 'user', message: { content: `multi\nline\t${longText}` } }),
        ], 1000);

        const result = await listRecentSessions({ vaultPath: VAULT, claudeHome });
        expect(result[0].preview.length).toBeLessThanOrEqual(80);
        expect(result[0].preview.endsWith('…')).toBe(true);
        expect(result[0].preview).not.toContain('\n');
        expect(result[0].preview).not.toContain('\t');
    });

    it('extracts text from array-shaped content blocks', async () => {
        writeSession(projectDir, makeUuid(1), [
            JSON.stringify({
                type: 'user',
                message: {
                    content: [
                        { type: 'text', text: 'hello from blocks' },
                        { type: 'image', source: {} },
                    ],
                },
            }),
        ], 1000);

        const result = await listRecentSessions({ vaultPath: VAULT, claudeHome });
        expect(result[0].preview).toBe('hello from blocks');
    });
});

describe('formatRelativeTime', () => {
    const now = new Date('2026-05-09T12:00:00Z');

    it('formats seconds, minutes, hours, days', () => {
        expect(formatRelativeTime(new Date('2026-05-09T11:59:30Z'), now)).toBe('30s ago');
        expect(formatRelativeTime(new Date('2026-05-09T11:55:00Z'), now)).toBe('5m ago');
        expect(formatRelativeTime(new Date('2026-05-09T10:00:00Z'), now)).toBe('2h ago');
        expect(formatRelativeTime(new Date('2026-05-06T12:00:00Z'), now)).toBe('3d ago');
    });

    it('handles future timestamps as "just now"', () => {
        expect(formatRelativeTime(new Date('2026-05-09T12:01:00Z'), now)).toBe('just now');
    });
});
