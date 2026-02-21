import { Transform, type TransformCallback } from 'node:stream';

// Pino numeric log levels
const LEVEL_DEBUG = 20;
const LEVEL_INFO = 30;
const LEVEL_WARN = 40;
const LEVEL_ERROR = 50;

const LEVEL_EMOJI: Record<number, string> = {
    [LEVEL_DEBUG]: '🔍',
    [LEVEL_INFO]: 'ℹ️',
    [LEVEL_WARN]: '⚠️',
    [LEVEL_ERROR]: '❌',
};

const EVENT_EMOJI: Record<string, string> = {
    startup: '🚀',
    shutdown: '🛑',
    session_start: '🤖',
    session_complete: '✅',
    session_failed: '💥',
    session_timeout: '⏳',
    session_queued: '📥',
    message_received: '📩',
    cron_triggered: '⏰',
    cron_scheduled: '📋',
    tool_use: '🔧',
    tool_result: '📄',
    assistant_text: '💭',
    response_ready: '💬',
    auto_continue: '🔄',
};

function formatTime(epoch: number): string {
    const d = new Date(epoch);
    return d.toTimeString().slice(0, 8); // HH:MM:SS
}

function formatBanner(emoji: string, title: string, timestamp: string): string {
    const line1 = `  ${emoji} ${title}`;
    const line2 = `  ${timestamp}`;
    const width = Math.max(line1.length, line2.length, 38) + 2;
    const top = '╔' + '═'.repeat(width) + '╗';
    const bot = '╚' + '═'.repeat(width) + '╝';
    const pad1 = line1 + ' '.repeat(width - line1.length);
    const pad2 = line2 + ' '.repeat(width - line2.length);
    return `${top}\n║${pad1}║\n║${pad2}║\n${bot}`;
}

function formatSessionLine(emoji: string, parts: string): string {
    return `── ${emoji} ${parts} ──`;
}

export function formatLogObject(log: Record<string, unknown>): string {
    const time = formatTime(log.time as number || Date.now());
    const event = log.event as string | undefined;
    const msg = (log.msg as string) || '';
    const level = (log.level as number) || LEVEL_INFO;

    // Banner events
    if (event === 'startup') {
        const fullTimestamp = new Date(log.time as number || Date.now()).toISOString().replace('T', ' ').slice(0, 19);
        return formatBanner('🚀', msg || 'Claude Conductor starting', fullTimestamp);
    }
    if (event === 'shutdown') {
        return formatBanner('🛑', 'Claude Conductor shutting down', formatTime(log.time as number || Date.now()));
    }

    // Session lifecycle events — separator lines
    if (event === 'session_start') {
        const source = log.source || '?';
        const taskId = log.taskId || '';
        const prompt = log.prompt as string | undefined;
        let line = formatSessionLine('🤖', `Session started [${source}] ${taskId}`);
        if (prompt) {
            line += `\n${time}    📝 "${prompt}"`;
        }
        return `${time} ${line}`;
    }
    if (event === 'session_complete') {
        const source = log.source || '?';
        const taskId = log.taskId || '';
        const duration = log.duration != null ? `${log.duration}s` : '';
        const turns = log.numTurns != null ? `${log.numTurns} turns` : '';
        const details = [duration, turns].filter(Boolean).join(', ');
        return `${time} ${formatSessionLine('✅', `Session complete [${source}] ${taskId}${details ? ' — ' + details : ''}`)}`;
    }
    if (event === 'session_failed') {
        const source = log.source || '?';
        const taskId = log.taskId || '';
        const err = log.err as Record<string, unknown> | undefined;
        const errMsg = err?.message || msg;
        return `${time} ${formatSessionLine('💥', `Session failed [${source}] ${taskId} — ${errMsg}`)}`;
    }
    if (event === 'session_timeout') {
        const source = log.source || '?';
        const taskId = log.taskId || '';
        return `${time} ${formatSessionLine('⏳', `Session timed out [${source}] ${taskId}`)}`;
    }

    // Inline events
    if (event === 'session_queued') {
        const source = log.source || '?';
        const taskId = log.taskId || '';
        const ql = log.queueLength ?? '?';
        return `${time} 📥 Session queued [${source}] ${taskId} (queue: ${ql})`;
    }
    if (event === 'message_received') {
        const userId = log.userId ?? '';
        const text = log.text as string | undefined;
        return `${time} 📩 Message from user ${userId}: "${text || ''}"`;

    }
    if (event === 'cron_triggered') {
        const name = log.name || msg;
        return `${time} ⏰ Cron job "${name}" triggered`;
    }
    if (event === 'cron_scheduled') {
        const name = log.name || '';
        const schedule = log.schedule || '';
        return `${time} 📋 Scheduled: "${name}" @ ${schedule}`;
    }
    if (event === 'tool_use') {
        const tool = log.tool || 'unknown';
        const arg = log.arg ? ` → ${log.arg}` : '';
        return `${time}    🔧 ${tool}${arg}`;
    }
    if (event === 'tool_result') {
        const lines = log.lines ?? '?';
        const preview = log.preview as string | undefined;
        const formatted = preview ? preview.replace(/\n/g, '↵') : '';
        return `${time}    📄 Tool result (${lines} lines): "${formatted}"`;
    }
    if (event === 'assistant_text') {
        const preview = log.preview as string || '';
        return `${time}    💭 "${preview}"`;
    }
    if (event === 'response_ready') {
        const turns = log.numTurns != null ? `${log.numTurns} turns` : '';
        const duration = log.duration != null ? `${log.duration}s` : '';
        const details = [turns, duration].filter(Boolean).join(', ');
        return `${time}    💬 Response ready${details ? ' (' + details + ')' : ''}`;
    }
    if (event === 'auto_continue') {
        const depth = log.continuationDepth ?? '?';
        const maxDepth = log.maxDepth ?? '2';
        return `${time} 🔄 Max turns, auto-continuing (${depth}/${maxDepth})`;
    }

    // Generic fallback — level-based emoji
    const emoji = LEVEL_EMOJI[level] ?? 'ℹ️';
    const module = log.module || log.name;
    const prefix = module ? `[${module}] ` : '';
    return `${time} ${emoji} ${prefix}${msg}`;
}

class LoggerTransport extends Transform {
    constructor() {
        super({ objectMode: true });
    }

    _transform(chunk: Buffer | string, _encoding: string, callback: TransformCallback): void {
        const str = typeof chunk === 'string' ? chunk : chunk.toString();

        // Pino transports can receive newline-delimited JSON
        for (const line of str.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            try {
                const log = JSON.parse(trimmed);
                const formatted = formatLogObject(log);
                this.push(formatted + '\n');
            } catch {
                // Non-JSON lines — pass through
                this.push(trimmed + '\n');
            }
        }

        callback();
    }
}

// Pino transport entry point — must export default a function that returns a stream
export default function () {
    const transport = new LoggerTransport();
    transport.pipe(process.stdout);
    return transport;
}

// Named exports for testing
export { LoggerTransport, EVENT_EMOJI, LEVEL_EMOJI };
