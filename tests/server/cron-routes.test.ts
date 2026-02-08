import { describe, it, expect, vi, beforeEach } from 'vitest';
import fastify from 'fastify';
import { registerCronRoutes } from '../../src/server/cron-routes.js';
import type { DatabaseManager } from '../../src/db/index.js';
import type { CronScheduler } from '../../src/cron/scheduler.js';

describe('Cron API Routes', () => {
    const app = fastify();

    const mockDb = {
        listCronJobs: vi.fn(),
        getCronJob: vi.fn(),
        createCronJob: vi.fn(),
        updateCronJob: vi.fn(),
        deleteCronJob: vi.fn(),
    } as unknown as DatabaseManager;

    const mockScheduler = {
        addJob: vi.fn(),
        removeJob: vi.fn()
    } as unknown as CronScheduler;

    registerCronRoutes(app, mockDb, mockScheduler);

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('POST /api/cron should create a job', async () => {
        const payload = {
            name: 'new-job',
            schedule: '* * * * *',
            prompt: 'do something',
            output: 'log'
        };

        (mockDb.getCronJob as any).mockReturnValue(undefined); // No existing
        (mockDb.createCronJob as any).mockReturnValue({ ...payload, id: 1, enabled: 1 });

        const response = await app.inject({
            method: 'POST',
            url: '/api/cron',
            payload
        });

        expect(response.statusCode).toBe(201);
        expect(mockDb.createCronJob).toHaveBeenCalledWith(expect.objectContaining({
            name: 'new-job'
        }));
        expect(mockScheduler.addJob).toHaveBeenCalled();
    });

    it('POST /api/cron shoud return 409 if exists', async () => {
        (mockDb.getCronJob as any).mockReturnValue({ name: 'existing' });

        const response = await app.inject({
            method: 'POST',
            url: '/api/cron',
            payload: { name: 'existing', schedule: '*', prompt: 'x' }
        });

        expect(response.statusCode).toBe(409);
    });

    it('GET /api/cron should list jobs', async () => {
        (mockDb.listCronJobs as any).mockReturnValue([{ name: 'j1' }]);

        const response = await app.inject({
            method: 'GET',
            url: '/api/cron'
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ jobs: [{ name: 'j1' }] });
    });

    it('DELETE /api/cron/:name should remove job', async () => {
        (mockDb.deleteCronJob as any).mockReturnValue(true);

        const response = await app.inject({
            method: 'DELETE',
            url: '/api/cron/test-job'
        });

        expect(response.statusCode).toBe(200);
        expect(mockScheduler.removeJob).toHaveBeenCalledWith('test-job');
    });
});
