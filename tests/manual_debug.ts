import { main } from '../src/main.js';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function run() {
    const tempDir = join(tmpdir(), `harness-debug-${Date.now()}`);
    mkdirSync(tempDir);
    const configPath = join(tempDir, 'config.yaml');
    const dbPath = join(tempDir, 'harness.db');

    writeFileSync(configPath, `
telegram:
  bot_token: "test-token"
  allowed_users: [123]
queue:
  max_concurrent: 1
`);

    process.env.CONFIG_PATH = configPath;
    process.env.DB_PATH = dbPath;
    process.env.PORT = '0';
    process.env.NODE_ENV = 'test';

    console.log('Running main...');
    try {
        const result = await main();
        console.log('Result keys:', Object.keys(result));
        const { app, bot, dispatcher, db } = result;

        console.log('App defined?', !!app);
        console.log('Bot defined?', !!bot);
        console.log('Dispatcher defined?', !!dispatcher);
        console.log('DB defined?', !!db);

        await app.close();
        if (db) db.close();
        if (bot) await bot.stop();
    } catch (e) {
        console.error('Main failed:', e);
    } finally {
        try { rmSync(tempDir, { recursive: true, force: true }); } catch { }
    }
}

run();
