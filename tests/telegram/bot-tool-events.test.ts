import { describe, it, expect } from 'vitest';
import { formatToolStatus } from '../../src/telegram/bot.js';

describe('formatToolStatus', () => {
    it('should format tool with arg', () => {
        expect(formatToolStatus('Read', '/vault/file.md')).toBe('[tool] Read: /vault/file.md');
    });

    it('should format tool without arg', () => {
        expect(formatToolStatus('Task')).toBe('[tool] Task');
    });

    it('should format tool with undefined arg', () => {
        expect(formatToolStatus('Grep', undefined)).toBe('[tool] Grep');
    });

    it('should truncate args exceeding 120 chars', () => {
        const longArg = 'a'.repeat(150);
        const result = formatToolStatus('Bash', longArg);
        // [tool] Bash: + 120 chars + …
        expect(result).toBe(`[tool] Bash: ${'a'.repeat(120)}…`);
        expect(result.length).toBe('[tool] Bash: '.length + 120 + 1);
    });

    it('should not truncate args exactly at 120 chars', () => {
        const arg = 'b'.repeat(120);
        const result = formatToolStatus('Read', arg);
        expect(result).toBe(`[tool] Read: ${'b'.repeat(120)}`);
    });

    it('should collapse newlines and tabs to spaces', () => {
        const result = formatToolStatus('Bash', 'echo "hello"\necho "world"\techo "!"');
        expect(result).toBe('[tool] Bash: echo "hello" echo "world" echo "!"');
    });

    it('should collapse runs of whitespace', () => {
        const result = formatToolStatus('Bash', 'echo   "hello"   "world"');
        expect(result).toBe('[tool] Bash: echo "hello" "world"');
    });

    it('should collapse multiline bash commands to single line', () => {
        const multiline = "cd /vault &&\ngrep -r \"TODO\"\n--include=\"*.md\"";
        const result = formatToolStatus('Bash', multiline);
        expect(result).toBe('[tool] Bash: cd /vault && grep -r "TODO" --include="*.md"');
    });

    it('should trim whitespace from arg', () => {
        const result = formatToolStatus('Read', '  /vault/file.md  ');
        expect(result).toBe('[tool] Read: /vault/file.md');
    });
});

describe('ConfigSchema show_tool_events', () => {
    // Importing here to keep test focused
    let ConfigSchema: typeof import('../../src/config/schema.js').ConfigSchema;

    // Dynamic import to avoid module resolution issues
    it('should default show_tool_events to true when omitted', async () => {
        const mod = await import('../../src/config/schema.js');
        ConfigSchema = mod.ConfigSchema;
        const result = ConfigSchema.safeParse({
            telegram: { bot_token: 'x', allowed_users: [1] }
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.telegram?.show_tool_events).toBe(true);
        }
    });

    it('should accept show_tool_events: false', async () => {
        const mod = await import('../../src/config/schema.js');
        const result = mod.ConfigSchema.safeParse({
            telegram: { bot_token: 'x', allowed_users: [1], show_tool_events: false }
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.telegram?.show_tool_events).toBe(false);
        }
    });
});
