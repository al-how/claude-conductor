import pino from 'pino';
import createTransport from './logger-transport.js';

export interface LoggerOptions {
    level?: string;
}

export function createLogger(options: LoggerOptions = {}) {
    const { level = 'info' } = options;
    const useJson = process.env.LOG_FORMAT === 'json';

    if (useJson) {
        return pino({ name: 'claude-harness', level });
    }

    return pino({ name: 'claude-harness', level }, createTransport());
}
