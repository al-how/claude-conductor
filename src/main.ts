import Fastify from 'fastify';
import { loadConfig } from './config/loader.js';
import { createLogger } from './logger.js';
import { registerHealthRoute } from './server/health.js';

export async function main() {
    const logger = createLogger({
        level: process.env.LOG_LEVEL ?? 'info',
        pretty: process.env.NODE_ENV !== 'production',
    });

    logger.info('Claude Harness starting');

    // Load config
    const configPath = process.env.CONFIG_PATH ?? '/config/config.yaml';
    try {
        loadConfig(configPath);
        logger.info({ configPath }, 'Config loaded');
    } catch (err) {
        if (process.env.NODE_ENV !== 'test') {
            logger.fatal({ err, configPath }, 'Failed to load config');
            process.exit(1);
        } else {
            logger.warn({ err, configPath }, 'Failed to load config (suppressed in test)');
        }
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
        process.exit(1);
    }

    // Graceful shutdown
    const shutdown = async (signal: string) => {
        logger.info({ signal }, 'Shutting down');
        await app.close();
        process.exit(0);
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    logger.info('Claude Harness ready');
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
