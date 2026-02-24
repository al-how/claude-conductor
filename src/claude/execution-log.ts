import { join } from 'node:path';
import { mkdir, writeFile, readdir, unlink } from 'node:fs/promises';
import type { StreamEvent } from './invoke.js';

const MAX_PROMPT_LENGTH = 2000;
const MAX_RESULT_LENGTH = 3000;
const MAX_LOGS_PER_JOB = 10;

export class ExecutionLogCollector {
    private events: StreamEvent[] = [];

    public collect = (event: StreamEvent): void => {
        if (event.type === 'text_delta') return;
        this.events.push(event);
    };

    public getEvents(): StreamEvent[] {
        return this.events;
    }
}

export interface ExecutionLogMeta {
    jobName: string;
    prompt: string;
    startedAt: string;
    finishedAt: string;
    exitCode: number;
}

export function formatExecutionLog(events: StreamEvent[], meta: ExecutionLogMeta): string {
    const lines: string[] = [];

    // Header
    lines.push(`# Execution Log: ${meta.jobName}`);
    lines.push('');
    lines.push(`- **Started:** ${meta.startedAt}`);
    lines.push(`- **Finished:** ${meta.finishedAt}`);
    lines.push(`- **Exit code:** ${meta.exitCode}`);

    // Extract model from system_init event
    const initEvent = events.find(e => e.type === 'system_init');
    if (initEvent?.data.model) {
        lines.push(`- **Model:** ${initEvent.data.model}`);
    }

    // Prompt
    lines.push('');
    lines.push('## Prompt');
    lines.push('');
    const promptText = meta.prompt.length > MAX_PROMPT_LENGTH
        ? meta.prompt.slice(0, MAX_PROMPT_LENGTH) + '\n\n(truncated)'
        : meta.prompt;
    lines.push(promptText);

    // Execution timeline
    lines.push('');
    lines.push('## Execution Timeline');
    lines.push('');

    for (const event of events) {
        switch (event.type) {
            case 'tool_use': {
                const tool = event.data.tool as string;
                const arg = event.data.arg as string | undefined;
                lines.push(`### Tool: ${tool}`);
                if (arg) {
                    lines.push(`> ${arg}`);
                }
                lines.push('');
                break;
            }
            case 'tool_result': {
                const content = event.data.content as string;
                const resultLines = event.data.lines as number;
                const truncated = content.length > MAX_RESULT_LENGTH
                    ? content.slice(0, MAX_RESULT_LENGTH) + '\n\n(truncated)'
                    : content;
                lines.push(`**Result** (${resultLines} lines):`);
                lines.push(truncated);
                lines.push('');
                break;
            }
            case 'assistant_text': {
                const text = event.data.text as string;
                lines.push(text);
                lines.push('');
                break;
            }
            case 'result': {
                const text = event.data.text as string | undefined;
                if (text) {
                    lines.push('## Final Output');
                    lines.push('');
                    lines.push(text);
                    lines.push('');
                }
                break;
            }
            // system_init and error are not rendered in the timeline
        }
    }

    return lines.join('\n');
}

export async function writeExecutionLog(
    vaultPath: string,
    jobName: string,
    content: string,
    startedAt: string,
): Promise<string> {
    const logDir = join(vaultPath, 'agent-files', 'logs', jobName);
    await mkdir(logDir, { recursive: true });

    const date = new Date(startedAt);
    const pad = (n: number) => String(n).padStart(2, '0');
    const filename = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.md`;
    const logPath = join(logDir, filename);

    await writeFile(logPath, content, 'utf-8');
    return logPath;
}

export async function pruneOldLogs(vaultPath: string, jobName: string): Promise<void> {
    const logDir = join(vaultPath, 'agent-files', 'logs', jobName);

    let files: string[];
    try {
        files = (await readdir(logDir)).filter(f => f.endsWith('.md')).sort();
    } catch {
        return; // Directory doesn't exist yet
    }

    if (files.length <= MAX_LOGS_PER_JOB) return;

    const toDelete = files.slice(0, files.length - MAX_LOGS_PER_JOB);
    for (const file of toDelete) {
        await unlink(join(logDir, file));
    }
}
