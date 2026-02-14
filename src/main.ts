import { fastify } from 'fastify';
import { dirname, join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config/loader.js';
import { createLogger } from './logger.js';
import { registerHealthRoute } from './server/health.js';
import { registerCronRoutes } from './server/cron-routes.js';
import { DatabaseManager } from './db/index.js';
import { Dispatcher } from './dispatcher/index.js';
import { TelegramBot } from './telegram/bot.js';
import { CronScheduler } from './cron/scheduler.js';

export async function main() {
    const logger = createLogger({
        level: process.env.LOG_LEVEL || 'info',
    });

    logger.info({ event: 'startup' }, 'Claude Conductor starting');

    // Load config
    const config = loadConfig();
    logger.info({ configPath: process.env.CONFIG_PATH }, 'Config loaded');

    // Initialize DB
    const dbPath = process.env.DB_PATH || '/data/harness.db';

    // Create DB directory if it doesn't exist
    const dbDir = dirname(dbPath);
    if (!existsSync(dbDir)) {
        mkdirSync(dbDir, { recursive: true });
    }

    let db: DatabaseManager | undefined;
    try {
        db = new DatabaseManager(dbPath, logger);
    } catch (err) {
        logger.error({ err, dbPath }, 'Failed to initialize database');
        // Continue? Or exit?
        process.exit(1);
    }

    // Initialize Dispatcher
    const dispatcher = new Dispatcher(config.queue.max_concurrent, logger);

    // Initialize Telegram Bot
    let bot: TelegramBot | undefined;
    if (config.telegram) {
        // TelegramBot expects (config: TelegramConfig, logger: Logger, db: DatabaseManager, dispatcher: Dispatcher)
        // Adjust to match TelegramBotConfig interface: { token, allowedUsers, ... }
        bot = new TelegramBot({
            token: config.telegram.bot_token,
            allowedUsers: config.telegram.allowed_users,
            workingDir: config.vault_path,
            logger,
            db,
            dispatcher
        });
        // bot.start() begins long-polling and only resolves on stop() — don't await it
        bot.start().catch(err => logger.error({ err }, 'Telegram Bot polling error'));
        logger.info('Telegram Bot started');
    }

    // Initialize Cron Scheduler
    const scheduler = new CronScheduler({
        dispatcher,
        vaultPath: config.vault_path,
        logger,
        db: db!, // DB is initialized above, checking logic might need improvement but following flow
        sendTelegram: bot
            ? (text) => bot!.sendMessage(config.telegram!.allowed_users[0], text)
            : undefined
    });
    scheduler.start();

    // Init Server (Fastify)
    const app = fastify({ logger: false }); // We use our own logger

    // Health check
    registerHealthRoute(app);
    // Cron routes
    registerCronRoutes(app, db!, scheduler);

    // Write runtime instructions for Claude Code
    try {
        const rulesDir = join(config.vault_path, '.claude', 'rules');
        if (!existsSync(rulesDir)) {
            mkdirSync(rulesDir, { recursive: true });
        }

        const rulesContent = `# Scheduled Tasks API

You can create, list, and manage scheduled tasks via the harness API at http://localhost:3000.

## Create a scheduled task
curl -s -X POST http://localhost:3000/api/cron \\
  -H "Content-Type: application/json" \\
  -d '{"name": "task-name", "schedule": "0 9 * * *", "prompt": "...", "output": "telegram"}'

## List all scheduled tasks
curl -s http://localhost:3000/api/cron

## Update a task
curl -s -X PATCH http://localhost:3000/api/cron/task-name \\
  -H "Content-Type: application/json" \\
  -d '{"schedule": "0 21 * * *"}'

## Delete a task
curl -s -X DELETE http://localhost:3000/api/cron/task-name

Schedule uses standard cron expressions. Output options: telegram, log, silent.
`;
        writeFileSync(join(rulesDir, 'harness-api.md'), rulesContent);
        logger.info({ path: join(rulesDir, 'harness-api.md') }, 'Written API rules for Claude Code');
    } catch (err) {
        logger.error({ err }, 'Failed to write API rules file');
    }

    // Start server
    const port = parseInt(process.env.PORT || '3000', 10);
    const host = process.env.HOST || '0.0.0.0';

    try {
        await app.listen({ port, host });
        logger.info({ port, host }, 'Server listening');
    } catch (err) {
        logger.fatal({ err }, 'Failed to start server');
        if (process.env.NODE_ENV !== 'test') process.exit(1);
    }

    // Graceful shutdown
    /* v8 ignore start */
    const shutdown = async () => {
        logger.info({ event: 'shutdown' }, 'Shutting down...');
        scheduler.stop();
        await app.close();
        if (bot) await bot.stop();
        if (db) db.close();
        process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
    /* v8 ignore stop */

    return { app, bot, dispatcher, db, scheduler }; // Return for testing
}

// Run when executed directly
const isDirectRun = process.argv[1] &&
    pathToFileURL(process.argv[1]).href.toLowerCase() === import.meta.url.toLowerCase();

if (isDirectRun) {
    main().catch((err) => {
        console.error('Fatal:', err);
        process.exit(1);
    });
}
