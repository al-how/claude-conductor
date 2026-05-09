import { existsSync, readdirSync, statSync, createReadStream } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

export interface SessionSummary {
    uuid: string;
    mtime: Date;
    preview: string;
    startedAt?: Date;
}

export interface ListRecentSessionsOptions {
    vaultPath?: string;
    claudeHome?: string;
    limit?: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LINES_PER_FILE = 50;
const PREVIEW_MAX = 80;

function encodeProjectDir(vaultPath: string): string {
    return vaultPath.replace(/\//g, '-');
}

function isLocalCommandWrapper(content: string): boolean {
    const trimmed = content.trimStart();
    return trimmed.startsWith('<command-name>') || trimmed.startsWith('<local-command-');
}

function extractTextContent(content: unknown): string | undefined {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        const parts: string[] = [];
        for (const block of content) {
            if (block && typeof block === 'object' && 'text' in block && typeof (block as { text: unknown }).text === 'string') {
                parts.push((block as { text: string }).text);
            }
        }
        return parts.length ? parts.join(' ') : undefined;
    }
    return undefined;
}

function truncatePreview(text: string): string {
    const collapsed = text.replace(/\s+/g, ' ').trim();
    if (collapsed.length <= PREVIEW_MAX) return collapsed;
    return collapsed.slice(0, PREVIEW_MAX - 1).trimEnd() + '…';
}

async function readSessionMetadata(filePath: string): Promise<{ preview: string; startedAt?: Date }> {
    const stream = createReadStream(filePath, { encoding: 'utf8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    let preview: string | undefined;
    let startedAt: Date | undefined;
    let lineCount = 0;

    try {
        for await (const line of rl) {
            lineCount++;
            if (lineCount > MAX_LINES_PER_FILE) break;
            if (!line) continue;

            let event: Record<string, unknown>;
            try {
                event = JSON.parse(line);
            } catch {
                continue;
            }

            if (!startedAt && typeof event.timestamp === 'string') {
                const d = new Date(event.timestamp);
                if (!Number.isNaN(d.getTime())) startedAt = d;
            }

            if (!preview && event.type === 'user' && event.isMeta !== true) {
                const message = event.message as { content?: unknown } | undefined;
                const text = extractTextContent(message?.content);
                if (text && !isLocalCommandWrapper(text)) {
                    preview = truncatePreview(text);
                }
            }

            if (preview && startedAt) break;
        }
    } finally {
        rl.close();
        stream.destroy();
    }

    return { preview: preview ?? '(no user message)', startedAt };
}

export async function listRecentSessions(opts: ListRecentSessionsOptions = {}): Promise<SessionSummary[]> {
    const vaultPath = opts.vaultPath ?? process.env.VAULT_PATH ?? '/vault';
    const claudeHome = opts.claudeHome ?? process.env.CLAUDE_HOME ?? join(homedir(), '.claude');
    const limit = opts.limit ?? 10;

    const projectDir = join(claudeHome, 'projects', encodeProjectDir(vaultPath));
    if (!existsSync(projectDir)) return [];

    const entries = readdirSync(projectDir);
    const candidates: { uuid: string; path: string; mtime: Date }[] = [];

    for (const name of entries) {
        if (!name.endsWith('.jsonl')) continue;
        const uuid = name.slice(0, -'.jsonl'.length);
        if (!UUID_RE.test(uuid)) continue;

        const path = join(projectDir, name);
        let stat;
        try {
            stat = statSync(path);
        } catch {
            continue;
        }
        if (!stat.isFile()) continue;
        candidates.push({ uuid, path, mtime: stat.mtime });
    }

    candidates.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    const top = candidates.slice(0, limit);

    const summaries = await Promise.all(top.map(async (c) => {
        const meta = await readSessionMetadata(c.path);
        return { uuid: c.uuid, mtime: c.mtime, preview: meta.preview, startedAt: meta.startedAt };
    }));

    return summaries;
}

export function formatRelativeTime(from: Date, now: Date = new Date()): string {
    const diffMs = now.getTime() - from.getTime();
    if (diffMs < 0) return 'just now';
    const seconds = Math.floor(diffMs / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    const years = Math.floor(days / 365);
    return `${years}y ago`;
}
