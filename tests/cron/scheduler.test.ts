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

    // We can't easily test actual time-based execution without fake timers or waiting
    // but we can verify the job is registered with croner (improving confidence via getStatus)
});
