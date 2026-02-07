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
    private maxConcurrent: number = 1;

    constructor(maxConcurrent: number = 1, logger?: Logger) {
        this.maxConcurrent = maxConcurrent;
        this.logger = logger;
    }

    public enqueue(task: Task): void {
        this.queue.push(task);
        this.logger?.debug({ taskId: task.id, queueLength: this.queue.length }, 'Task enqueued');
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

                this.logger?.info({ taskId: task.id, source: task.source }, 'Processing task');

                try {
                    // Identify if we need to clean up options before passing to invokeClaude
                    // The Task interface extends ClaudeInvokeOptions, so we can pass it directly 
                    // (extra props like id, source, onComplete are ignored by invokeClaude or valid JS)
                    // But purely, let's pass just the options needed.
                    const { id, source, onComplete, onError, ...invokeOptions } = task;

                    // Inject logger if not present and available
                    if (!invokeOptions.logger && this.logger) {
                        invokeOptions.logger = this.logger;
                    }

                    const result = await invokeClaude(invokeOptions);

                    if (onComplete) {
                        await onComplete(result);
                    }
                } catch (error) {
                    this.logger?.error({ taskId: task.id, err: error }, 'Task processing failed');
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
