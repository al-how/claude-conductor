import type { Logger } from 'pino';
import { invokeClaude, type ClaudeInvokeOptions, type ClaudeResult } from '../claude/invoke.js';

export interface Task extends ClaudeInvokeOptions {
    id: string; // unique ID for tracking
    source: 'telegram' | 'cron' | 'webhook';
    onComplete?: (result: ClaudeResult) => Promise<void>;
    onError?: (error: Error) => Promise<void>;
}

export class Dispatcher {
    private queue: Task[] = [];
    private processing: boolean = false;
    private logger?: Logger;

    constructor(_maxConcurrent: number = 1, logger?: Logger) {
        this.logger = logger;
    }

    public enqueue(task: Task): void {
        this.queue.push(task);
        this.logger?.info({ event: 'session_queued', taskId: task.id, source: task.source, queueLength: this.queue.length }, 'Session queued');
        this.processQueue();
    }

    private async processQueue(): Promise<void> {
        if (this.processing) return;
        if (this.queue.length === 0) return;

        this.processing = true;

        try {
            while (this.queue.length > 0) {
                const task = this.queue.shift();
                if (!task) break;

                const { id, source, onComplete, onError, ...invokeOptions } = task;

                const startTime = Date.now();
                this.logger?.info({ event: 'session_start', taskId: task.id, source: task.source, prompt: task.prompt }, 'Session started');

                try {
                    // Inject logger if not present and available
                    if (!invokeOptions.logger && this.logger) {
                        invokeOptions.logger = this.logger;
                    }

                    const result = await invokeClaude(invokeOptions);

                    const duration = Math.round((Date.now() - startTime) / 1000);
                    this.logger?.info({ event: 'session_complete', taskId: task.id, source: task.source, duration, numTurns: result.numTurns, exitCode: result.exitCode }, 'Session complete');

                    if (onComplete) {
                        await onComplete(result);
                    }
                } catch (error) {
                    const duration = Math.round((Date.now() - startTime) / 1000);
                    this.logger?.error({ event: 'session_failed', taskId: task.id, source: task.source, duration, err: error }, 'Session failed');
                    if (task.onError) {
                        await task.onError(error as Error);
                    }
                }
            }
        } finally {
            this.processing = false;
            // Check if more tasks arrived while processing (though while loop handles it, this safety check is fine)
            if (this.queue.length > 0) {
                void this.processQueue();
            }
        }
    }

    public getQueueLength(): number {
        return this.queue.length;
    }

    public isBusy(): boolean {
        return this.processing;
    }
}
