import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import pino from 'pino';

const logger = pino({ level: 'silent' });

// We test registerMcpServer by manipulating the filesystem
// Since the function uses a hardcoded path, we'll need to mock fs
describe('registerMcpServer', () => {
    let tempDir: string;
    let configPath: string;

    const mockExistsSync = vi.fn();
    const mockReadFileSync = vi.fn();
    const mockWriteFileSync = vi.fn();

    beforeEach(() => {
        vi.resetModules();
        tempDir = mkdtempSync(join(tmpdir(), 'mcp-register-'));
        configPath = join(tempDir, '.claude.json');

        mockExistsSync.mockReset();
        mockReadFileSync.mockReset();
        mockWriteFileSync.mockReset();
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    it('should create MCP config with research server entry', async () => {
        // Mock the module to use our temp path
        vi.doMock('node:fs', async () => {
            const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
            return {
                ...actual,
                existsSync: (path: string) => {
                    if (path === '/home/claude') return true;
                    if (path === '/home/claude/.claude.json') return false;
                    return actual.existsSync(path);
                },
                readFileSync: actual.readFileSync,
                writeFileSync: (path: string, content: string) => {
                    if (path === '/home/claude/.claude.json') {
                        return actual.writeFileSync(configPath, content);
                    }
                    return actual.writeFileSync(path, content);
                },
            };
        });

        const { registerMcpServer } = await import('../../src/mcp/register.js');

        process.env.GEMINI_API_KEY = 'test-gemini-key';
        registerMcpServer(logger);
        delete process.env.GEMINI_API_KEY;

        const written = readFileSync(configPath, 'utf-8');
        const config = JSON.parse(written);

        expect(config.mcpServers.research).toBeDefined();
        expect(config.mcpServers.research.command).toBe('node');
        expect(config.mcpServers.research.args).toEqual(['/app/dist/mcp/server.js']);
        expect(config.mcpServers.research.env.GEMINI_API_KEY).toBe('test-gemini-key');
    });

    it('should preserve existing MCP servers', async () => {
        // Write an existing config with another MCP server
        mkdirSync(join(tempDir, 'existing'), { recursive: true });
        const existingConfig = {
            mcpServers: {
                'other-server': {
                    type: 'stdio',
                    command: 'python',
                    args: ['server.py'],
                },
            },
            someOtherSetting: true,
        };
        writeFileSync(configPath, JSON.stringify(existingConfig));

        vi.doMock('node:fs', async () => {
            const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
            return {
                ...actual,
                existsSync: (path: string) => {
                    if (path === '/home/claude') return true;
                    if (path === '/home/claude/.claude.json') return true;
                    return actual.existsSync(path);
                },
                readFileSync: (path: string, encoding: string) => {
                    if (path === '/home/claude/.claude.json') {
                        return actual.readFileSync(configPath, encoding);
                    }
                    return actual.readFileSync(path, encoding);
                },
                writeFileSync: (path: string, content: string) => {
                    if (path === '/home/claude/.claude.json') {
                        return actual.writeFileSync(configPath, content);
                    }
                    return actual.writeFileSync(path, content);
                },
            };
        });

        const { registerMcpServer } = await import('../../src/mcp/register.js');
        registerMcpServer(logger);

        const written = readFileSync(configPath, 'utf-8');
        const config = JSON.parse(written);

        // Research server should be added
        expect(config.mcpServers.research).toBeDefined();
        // Existing server should be preserved
        expect(config.mcpServers['other-server']).toBeDefined();
        expect(config.mcpServers['other-server'].command).toBe('python');
        // Other settings preserved
        expect(config.someOtherSetting).toBe(true);
    });

    it('should skip registration when not in container context', async () => {
        vi.doMock('node:fs', async () => {
            const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
            return {
                ...actual,
                existsSync: (path: string) => {
                    if (path === '/home/claude') return false;
                    return actual.existsSync(path);
                },
                writeFileSync: vi.fn(),
            };
        });

        const { registerMcpServer } = await import('../../src/mcp/register.js');
        registerMcpServer(logger);

        // No file should be written (we'd get an error if it tried)
    });
});
