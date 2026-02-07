import pino from 'pino';

export interface LoggerOptions {
    level?: string;
    pretty?: boolean;
}

export function createLogger(options: LoggerOptions = {}) {
    const { level = 'info', pretty = process.env.NODE_ENV !== 'production' } = options;

    return pino({
        name: 'claude-harness',
        level,
        transport: pretty
            ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' } }
            : undefined
    });
}
