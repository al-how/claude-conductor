import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { main } from '../src/main.js';
import { writeFileSync, mkdirSync, rmdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('../src/telegram/bot.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        // @ts-ignore
        ...actual,
        TelegramBot: vi.fn().mockImplementation(() => ({
            start: vi.fn().mockResolvedValue(undefined),
            stop: vi.fn().mockResolvedValue(undefined),
        }))
    };
});

describe('main integration', () => {
    let tempDir: string;
    let configPath: string;
    let dbPath: string;

    beforeEach(() => {
        tempDir = join(tmpdir(), `harness-main-${Date.now()}`);
        mkdirSync(tempDir);

        configPath = join(tempDir, 'config.yaml');
        dbPath = join(tempDir, 'harness.db');

        writeFileSync(configPath, `
telegram:
  bot_token: "test-token"
  allowed_users: [123]
queue:
  max_concurrent: 1
`);

        process.env.CONFIG_PATH = configPath;
        process.env.DB_PATH = dbPath;
        process.env.PORT = '0'; // Random port
        process.env.NODE_ENV = 'test';
    });

    afterEach(() => {
        try {
            rmSync(tempDir, { recursive: true, force: true });
        } catch (e) {
            // Ignore cleanup errors on Windows/CI
        }
        vi.unstubAllEnvs();
    });

    it('should start up components correctly', async () => {
        try {
            console.log('Starting main()...');
            const result = await main();
            console.log('main() returned:', Object.keys(result));
            const { app, bot, dispatcher, db } = result;

            expect(app).toBeDefined();
            expect(bot).toBeDefined();
            expect(dispatcher).toBeDefined();
            expect(db).toBeDefined();

            // Clean up
            await app.close();
            db?.close();
        } catch (error) {
            console.error('Test failed with error:', error);
            throw error;
        }
    });
});
