import pino from 'pino';

/**
 * Create a logger that writes to stderr.
 * stdout is reserved for MCP JSON-RPC protocol communication.
 */
export function createMcpLogger(level: string = 'info') {
    return pino(
        { name: 'mcp-research', level },
        pino.destination({ fd: 2 }),  // stderr
    );
}
