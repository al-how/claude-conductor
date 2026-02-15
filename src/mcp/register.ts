import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Logger } from 'pino';

const CLAUDE_CONFIG_PATH = '/home/claude/.claude.json';

interface ClaudeConfig {
    mcpServers?: Record<string, {
        type: string;
        command: string;
        args: string[];
        env?: Record<string, string>;
    }>;
    [key: string]: unknown;
}

/**
 * Register the MCP research server in Claude Code's user-scope config.
 * Idempotent — safe to call every startup.
 * Only runs if the config file path exists (container context).
 */
export function registerMcpServer(logger: Logger): void {
    const configPath = CLAUDE_CONFIG_PATH;

    // Only run in container context
    const configDir = dirname(configPath);
    if (!existsSync(configDir)) {
        logger.info({ configDir }, 'Claude config directory not found — skipping MCP registration (not in container)');
        return;
    }

    // Read existing config or start fresh
    let config: ClaudeConfig = {};
    if (existsSync(configPath)) {
        try {
            const raw = readFileSync(configPath, 'utf-8');
            config = JSON.parse(raw) as ClaudeConfig;
        } catch (err) {
            logger.warn({ err, configPath }, 'Failed to parse existing .claude.json — will create new');
        }
    }

    // Ensure mcpServers object exists
    if (!config.mcpServers) {
        config.mcpServers = {};
    }

    // Build env vars from current process env (pass through to MCP server child process)
    const env: Record<string, string> = {};
    if (process.env.GEMINI_API_KEY) env.GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (process.env.OPENAI_API_KEY) env.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (process.env.OLLAMA_HOST) env.OLLAMA_HOST = process.env.OLLAMA_HOST;
    if (process.env.OLLAMA_MODEL) env.OLLAMA_MODEL = process.env.OLLAMA_MODEL;
    if (process.env.GEMINI_MODEL) env.GEMINI_MODEL = process.env.GEMINI_MODEL;
    if (process.env.OPENAI_MODEL) env.OPENAI_MODEL = process.env.OPENAI_MODEL;

    // Add/update the research MCP server entry
    config.mcpServers.research = {
        type: 'stdio',
        command: 'node',
        args: ['/app/dist/mcp/server.js'],
        env,
    };

    // Write back, preserving all other config
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
    logger.info({ configPath }, 'MCP research server registered in Claude config');
}
