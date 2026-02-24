import { describe, it, expect } from 'vitest';
import { ExecutionLogCollector } from '../../src/claude/execution-log.js';
import type { StreamEvent } from '../../src/claude/invoke.js';

describe('ExecutionLogCollector', () => {
    it('should skip text_delta events', () => {
        const collector = new ExecutionLogCollector();

        const textDelta: StreamEvent = {
            timestamp: new Date().toISOString(),
            type: 'text_delta',
            data: { text: 'Hello' }
        };
        const assistantText: StreamEvent = {
            timestamp: new Date().toISOString(),
            type: 'assistant_text',
            data: { text: 'Full response' }
        };
        const toolUse: StreamEvent = {
            timestamp: new Date().toISOString(),
            type: 'tool_use',
            data: { tool: 'Read', arg: '/file.txt' }
        };

        collector.collect(textDelta);
        collector.collect(assistantText);
        collector.collect(toolUse);
        collector.collect(textDelta);

        const events = collector.getEvents();
        expect(events).toHaveLength(2);
        expect(events[0].type).toBe('assistant_text');
        expect(events[1].type).toBe('tool_use');
    });
});
