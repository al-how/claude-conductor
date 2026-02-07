import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Dispatcher, type Task } from '../../src/dispatcher/index.js';
import * as ClaudeInvoke from '../../src/claude/invoke.js';

describe('Dispatcher', () => {
    let dispatcher: Dispatcher;

    beforeEach(() => {
        dispatcher = new Dispatcher(1);
        vi.restoreAllMocks();
    });

    it('should enqueue and process a task', async () => {
        const invokeSpy = vi.spyOn(ClaudeInvoke, 'invokeClaude').mockResolvedValue({
            exitCode: 0,
            stdout: '{}',
            stderr: '',
            timedOut: false
        });

        return new Promise<void>((resolve) => {
            const task: Task = {
                id: '1',
                source: 'telegram',
                prompt: 'test',
                onComplete: async (result) => {
                    expect(result.exitCode).toBe(0);
                    expect(invokeSpy).toHaveBeenCalled();
                    resolve();
                }
            };
            dispatcher.enqueue(task);
        });
    });

    it('should process tasks sequentially (FIFO)', async () => {
        let callOrder: string[] = [];

        // Mock invokeClaude to take some time
        vi.spyOn(ClaudeInvoke, 'invokeClaude').mockImplementation(async (opts) => {
            await new Promise(r => setTimeout(r, 10)); // simulated delay
            callOrder.push(opts.prompt); // using prompt as ID for this test
            return { exitCode: 0, stdout: '{}', stderr: '', timedOut: false };
        });

        const p1 = new Promise<void>(resolve => {
            dispatcher.enqueue({
                id: '1',
                source: 'telegram',
                prompt: 'first',
                onComplete: async () => resolve()
            });
        });

        const p2 = new Promise<void>(resolve => {
            dispatcher.enqueue({
                id: '2',
                source: 'telegram',
                prompt: 'second',
                onComplete: async () => resolve()
            });
        });

        await Promise.all([p1, p2]);

        expect(callOrder).toEqual(['first', 'second']);
    });

    it('should handle errors gracefully', async () => {
        vi.spyOn(ClaudeInvoke, 'invokeClaude').mockRejectedValue(new Error('Spawn failed'));

        return new Promise<void>((resolve) => {
            dispatcher.enqueue({
                id: 'error-task',
                source: 'telegram',
                prompt: 'fail',
                onError: async (err) => {
                    expect(err.message).toBe('Spawn failed');
                    resolve();
                }
            });
        });
    });
});
