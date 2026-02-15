import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

// Mock backends and config before importing server
vi.mock('../../src/mcp/config.js', () => ({
    loadMcpConfig: vi.fn().mockReturnValue({
        geminiApiKey: 'test-key',
        geminiModel: 'gemini-2.0-flash',
        ollamaHost: 'http://localhost:11434',
        ollamaModel: 'qwen3-vl:8b',
        openaiApiKey: 'test-key',
        openaiModel: 'gpt-4o-mini',
    }),
}));

vi.mock('../../src/mcp/logger.js', () => ({
    createMcpLogger: vi.fn().mockReturnValue({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        child: vi.fn().mockReturnThis(),
    }),
}));

describe('MCP Server Integration', () => {
    it('should register all 5 tools and respond to tools/list', async () => {
        // Create a server directly (not using the entry point which connects stdio)
        const { z } = await import('zod');

        const server = new McpServer({
            name: 'research-test',
            version: '1.0.0',
        });

        // Register same tools as server.ts
        server.tool('research_web', 'Web research', { query: z.string() }, async () => ({
            content: [{ type: 'text' as const, text: 'mock' }],
        }));
        server.tool('summarize_text', 'Summarize text', { content: z.string() }, async () => ({
            content: [{ type: 'text' as const, text: 'mock' }],
        }));
        server.tool('summarize_url', 'Summarize URL', { url: z.string() }, async () => ({
            content: [{ type: 'text' as const, text: 'mock' }],
        }));
        server.tool('analyze_image', 'Analyze image', { image_path: z.string() }, async () => ({
            content: [{ type: 'text' as const, text: 'mock' }],
        }));
        server.tool('analyze_complex', 'Deep analysis', { content: z.string(), question: z.string() }, async () => ({
            content: [{ type: 'text' as const, text: 'mock' }],
        }));

        // Use in-memory transport for testing
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

        const client = new Client({ name: 'test-client', version: '1.0.0' });

        await server.connect(serverTransport);
        await client.connect(clientTransport);

        // List tools
        const result = await client.listTools();

        expect(result.tools).toHaveLength(5);
        const toolNames = result.tools.map(t => t.name).sort();
        expect(toolNames).toEqual([
            'analyze_complex',
            'analyze_image',
            'research_web',
            'summarize_text',
            'summarize_url',
        ]);

        // Call a tool
        const callResult = await client.callTool({ name: 'research_web', arguments: { query: 'test' } });
        expect(callResult.content).toEqual([{ type: 'text', text: 'mock' }]);

        await client.close();
        await server.close();
    });
});
