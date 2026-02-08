import { fastify } from 'fastify';
import { dirname } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config/loader.js';
import { createLogger } from './logger.js';
import { registerHealthRoute } from './server/health.js';
import { DatabaseManager } from './db/index.js';
import { Dispatcher } from './dispatcher/index.js';
import { TelegramBot } from './telegram/bot.js';

export async function main() {
    const logger = createLogger({
        level: process.env.LOG_LEVEL || 'info',
    });

    logger.info('Claude Conductor starting');

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
        await bot.start();
        logger.info('Telegram Bot started');
    }

    // Init Server (Fastify)
    const app = fastify({ logger: false }); // We use our own logger

    // Health check
    registerHealthRoute(app);

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
        logger.info('Shutting down...');
        await app.close();
        if (bot) await bot.stop();
        if (db) db.close();
        process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
    /* v8 ignore stop */

    return { app, bot, dispatcher, db }; // Return for testing
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
