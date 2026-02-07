import Fastify, { type FastifyInstance } from 'fastify';
import { loadConfig } from './config/loader.js';
import { createLogger } from './logger.js';
import { registerHealthRoute } from './server/health.js';
import { DatabaseManager } from './db/index.js';
import { Dispatcher } from './dispatcher/index.js';
import { TelegramBot } from './telegram/bot.js';
import { join } from 'node:path';

export async function main() {
    const logger = createLogger({
        level: process.env.LOG_LEVEL ?? 'info',
        pretty: process.env.NODE_ENV !== 'production',
    });

    logger.info('Claude Harness starting');

    // Load config
    const configPath = process.env.CONFIG_PATH ?? '/config/config.yaml';
    let config;
    try {
        config = loadConfig(configPath);
        logger.info({ configPath }, 'Config loaded');
    } catch (err) {
        // In test mode, we might want to proceed or mock, but main() usually runs in real env or test integration
        if (process.env.NODE_ENV !== 'test') {
            logger.fatal({ err, configPath }, 'Failed to load config');
            process.exit(1);
        } else {
            logger.warn({ err, configPath }, 'Failed to load config (suppressed in test)');
            // Create dummy config for test if not loaded
            config = {
                cron: [],
                webhooks: [],
                queue: { max_concurrent: 1, timeout_seconds: 300, priority: { telegram: 1, cron: 2, webhook: 3 } },
                browser: { enabled: false, headless: true, vnc: false }
            };
        }
    }

    // Identify DB path
    const dbPath = process.env.DB_PATH ?? '/data/harness.db';
    // Ensure directory exists if possible, strictly we expect the volume to be mounted
    // But for local dev we might need to create it.
    // We'll rely on the user/deployment to have the folder ready or mkdir it.

    // Initialize DB
    let db: DatabaseManager | undefined;
    try {
        db = new DatabaseManager(dbPath, logger);
    } catch (err) {
        logger.error({ err, dbPath }, 'Failed to initialize database');
        // Continue? Or exit?
        // If DB is crucial, we should exit.
        if (process.env.NODE_ENV !== 'test') process.exit(1);
    }

    // Initialize Dispatcher
    const dispatcher = new Dispatcher(config.queue.max_concurrent, logger);

    // Initialize Telegram Bot
    let bot: TelegramBot | undefined;
    if (config.telegram) {
        bot = new TelegramBot({
            token: config.telegram.bot_token,
            allowedUsers: config.telegram.allowed_users,
            dispatcher,
            db,
            logger
        });

        try {
            await bot.start();
        } catch (err) {
            logger.error({ err }, 'Failed to start Telegram Bot');
        }
    } else {
        logger.info('Telegram Bot not configured');
    }

    // HTTP server
    const port = parseInt(process.env.PORT ?? '3000', 10);
    const host = process.env.HOST ?? '0.0.0.0';

    const app = Fastify({ logger });
    registerHealthRoute(app);

    try {
        await app.listen({ port, host });
    } catch (err) {
        logger.fatal({ err }, 'Failed to start server');
        if (process.env.NODE_ENV !== 'test') process.exit(1);
    }

    // Graceful shutdown
    const shutdown = async (signal: string) => {
        logger.info({ signal }, 'Shutting down');

        if (bot) {
            await bot.stop();
        }

        if (db) {
            db.close();
        }

        await app.close();
        process.exit(0);
    };

    // Listen for signals
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    logger.info('Claude Harness ready');

    return { app, bot, dispatcher, db }; // Return for testing
}

// Run when executed directly
// This check is a bit fragile with tsx/vitest but works for standard node execution
const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isDirectRun) {
    main().catch((err) => {
        console.error('Fatal:', err);
        process.exit(1);
    });
}
