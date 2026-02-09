import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CronScheduler } from '../../src/cron/scheduler.js';
import type { Dispatcher } from '../../src/dispatcher/index.js';
import type { DatabaseManager } from '../../src/db/index.js';
import type { Logger } from 'pino';

// Mock dependnecies
const mockLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis()
} as unknown as Logger;

const mockDispatcher = {
    enqueue: vi.fn()
} as unknown as Dispatcher;

const mockDb = {
    listCronJobs: vi.fn().mockReturnValue([]),
    logCronExecution: vi.fn()
} as unknown as DatabaseManager;

describe('CronScheduler', () => {
    let scheduler: CronScheduler;

    beforeEach(() => {
        vi.clearAllMocks();
        scheduler = new CronScheduler({
            dispatcher: mockDispatcher,
            vaultPath: '/tmp/vault',
            logger: mockLogger,
            db: mockDb
        });
    });

    afterEach(() => {
        scheduler.stop();
    });

    it('should start and load jobs from DB', () => {
        const jobs = [{
            id: 1,
            name: 'test-job',
            schedule: '* * * * *',
            prompt: 'hello',
            output: 'log',
            enabled: 1,
            created_at: '',
            updated_at: ''
        }];
        (mockDb.listCronJobs as any).mockReturnValue(jobs);

        scheduler.start();

        expect(mockDb.listCronJobs).toHaveBeenCalled();
        expect(scheduler.getStatus()).toHaveLength(1);
        expect(scheduler.getStatus()[0].name).toBe('test-job');
    });

    it('should add and remove jobs dynamically', () => {
        const job = {
            id: 1,
            name: 'dynamic-job',
            schedule: '0 0 * * *',
            prompt: 'run me',
            output: 'telegram',
            enabled: 1,
            created_at: '',
            updated_at: ''
        };

        scheduler.addJob(job);
        expect(scheduler.getStatus()).toHaveLength(1);

        scheduler.removeJob('dynamic-job');
        expect(scheduler.getStatus()).toHaveLength(0);
    });

    it('should not schedule disabled jobs', () => {
        const job = {
            id: 1,
            name: 'disabled-job',
            schedule: '* * * * *',
            prompt: 'no',
            output: 'log',
            enabled: 0,
            created_at: '',
            updated_at: ''
        };

        scheduler.addJob(job);
        expect(scheduler.getStatus()).toHaveLength(0);
    });

    it('should enqueue task with correct properties when cron fires', async () => {
        const job = {
            id: 1, name: 'dispatch-test', schedule: '* * * * *',
            prompt: 'test prompt', output: 'log', enabled: 1,
            created_at: '', updated_at: ''
        };

        scheduler.addJob(job);

        // Access the private executeJob method via the enqueue callback
        // The cron registered a callback — we can trigger it by calling executeJob directly
        const executeJob = (scheduler as any).executeJob.bind(scheduler);
        await executeJob(job);

        expect(mockDispatcher.enqueue).toHaveBeenCalledWith(
            expect.objectContaining({
                source: 'cron',
                prompt: 'test prompt',
                noSessionPersistence: true,
                allowedTools: ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
                maxTurns: 25,
                outputFormat: 'json'
            })
        );
    });

    it('should route output to telegram with job name prefix', async () => {
        const mockSendTelegram = vi.fn().mockResolvedValue(undefined);
        const telegramScheduler = new CronScheduler({
            dispatcher: mockDispatcher,
            vaultPath: '/tmp/vault',
            logger: mockLogger,
            db: mockDb,
            sendTelegram: mockSendTelegram
        });

        const job = {
            id: 1, name: 'tg-job', schedule: '* * * * *',
            prompt: 'hello', output: 'telegram', enabled: 1,
            created_at: '', updated_at: ''
        };

        // Capture the onComplete callback from enqueue and await it
        let onCompletePromise: Promise<void>;
        (mockDispatcher.enqueue as any).mockImplementation((task: any) => {
            onCompletePromise = task.onComplete({ exitCode: 0, stdout: '{"result":"test output"}', stderr: '', timedOut: false });
        });

        await (telegramScheduler as any).executeJob(job);
        await onCompletePromise!;

        expect(mockSendTelegram).toHaveBeenCalledWith('[tg-job]\n\ntest output');
        telegramScheduler.stop();
    });

    it('should route output to log when output is "log"', async () => {
        const job = {
            id: 1, name: 'log-job', schedule: '* * * * *',
            prompt: 'hello', output: 'log', enabled: 1,
            created_at: '', updated_at: ''
        };

        let onCompletePromise: Promise<void>;
        (mockDispatcher.enqueue as any).mockImplementation((task: any) => {
            onCompletePromise = task.onComplete({ exitCode: 0, stdout: '{"result":"logged"}', stderr: '', timedOut: false });
        });

        await (scheduler as any).executeJob(job);
        await onCompletePromise!;

        expect(mockLogger.info).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'log-job' }),
            expect.any(String)
        );
    });

    it('should fall back to log when output is "telegram" but no sendTelegram configured', async () => {
        const job = {
            id: 1, name: 'fallback-job', schedule: '* * * * *',
            prompt: 'hello', output: 'telegram', enabled: 1,
            created_at: '', updated_at: ''
        };

        let onCompletePromise: Promise<void>;
        (mockDispatcher.enqueue as any).mockImplementation((task: any) => {
            onCompletePromise = task.onComplete({ exitCode: 0, stdout: '{"result":"fallback"}', stderr: '', timedOut: false });
        });

        await (scheduler as any).executeJob(job);
        await onCompletePromise!;

        expect(mockLogger.warn).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'fallback-job' }),
            expect.any(String)
        );
    });

    it('should notify telegram on error when sendTelegram is configured', async () => {
        const mockSendTelegram = vi.fn().mockResolvedValue(undefined);
        const telegramScheduler = new CronScheduler({
            dispatcher: mockDispatcher,
            vaultPath: '/tmp/vault',
            logger: mockLogger,
            db: mockDb,
            sendTelegram: mockSendTelegram
        });

        const job = {
            id: 1, name: 'err-job', schedule: '* * * * *',
            prompt: 'hello', output: 'telegram', enabled: 1,
            created_at: '', updated_at: ''
        };

        let onErrorPromise: Promise<void>;
        (mockDispatcher.enqueue as any).mockImplementation((task: any) => {
            onErrorPromise = task.onError(new Error('something broke'));
        });

        await (telegramScheduler as any).executeJob(job);
        await onErrorPromise!;

        expect(mockSendTelegram).toHaveBeenCalledWith('[err-job] Error: something broke');
        expect(mockDb.logCronExecution).toHaveBeenCalledWith(
            expect.objectContaining({ error: 'something broke', exit_code: -1 })
        );
        telegramScheduler.stop();
    });

    it('should clean up all cron instances on stop', () => {
        const jobs = [
            { id: 1, name: 'j1', schedule: '0 * * * *', prompt: 'p1', output: 'log', enabled: 1, created_at: '', updated_at: '' },
            { id: 2, name: 'j2', schedule: '0 * * * *', prompt: 'p2', output: 'log', enabled: 1, created_at: '', updated_at: '' }
        ];

        for (const job of jobs) scheduler.addJob(job);
        expect(scheduler.getStatus()).toHaveLength(2);

        scheduler.stop();
        expect(scheduler.getStatus()).toHaveLength(0);
    });
});
