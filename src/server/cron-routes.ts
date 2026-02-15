import type { FastifyInstance } from 'fastify';
import type { DatabaseManager } from '../db/index.js';
import type { CronScheduler } from '../cron/scheduler.js';
import { z } from 'zod';
import { CronJobSchema } from '../config/schema.js';

const CronJobCreateSchema = CronJobSchema.extend({
    output: z.enum(['telegram', 'log', 'silent']).default('telegram'),
    enabled: z.number().min(0).max(1).optional()
});

const CronJobUpdateSchema = CronJobCreateSchema.partial().omit({ name: true });

export function registerCronRoutes(app: FastifyInstance, db: DatabaseManager, scheduler: CronScheduler) {
    // List all jobs
    app.get('/api/cron', async (_request, _reply) => {
        const jobs = db.listCronJobs();
        return { jobs };
    });

    // Get a single job
    app.get('/api/cron/:name', async (request, reply) => {
        const { name } = request.params as { name: string };
        const job = db.getCronJob(name);
        if (!job) return reply.status(404).send({ error: 'Job not found' });
        return { job };
    });

    // Create a new job
    app.post('/api/cron', async (request, reply) => {
        let body: z.infer<typeof CronJobCreateSchema>;
        try {
            body = CronJobCreateSchema.parse(request.body);
        } catch (err) {
            if (err instanceof z.ZodError) {
                return reply.status(400).send({ error: 'Validation failed', details: err.errors });
            }
            throw err;
        }

        const existing = db.getCronJob(body.name);
        if (existing) {
            return reply.status(409).send({ error: 'Job with this name already exists. Use PATCH to update.' });
        }

        const job = db.createCronJob({
            name: body.name,
            schedule: body.schedule,
            prompt: body.prompt,
            output: body.output,
            enabled: body.enabled ?? 1,
            timezone: body.timezone,
            max_turns: body.max_turns ?? null
        });

        scheduler.addJob(job);

        reply.status(201).send({ job });
    });

    // Update a job
    app.patch('/api/cron/:name', async (request, reply) => {
        const { name } = request.params as { name: string };

        let body: z.infer<typeof CronJobUpdateSchema>;
        try {
            body = CronJobUpdateSchema.parse(request.body);
        } catch (err) {
            if (err instanceof z.ZodError) {
                return reply.status(400).send({ error: 'Validation failed', details: err.errors });
            }
            throw err;
        }

        const job = db.updateCronJob(name, body);
        if (!job) return reply.status(404).send({ error: 'Job not found' });

        scheduler.removeJob(name); // Remove old schedule
        scheduler.addJob(job);     // Add new schedule (if enabled)

        return { job };
    });

    // Trigger a job on-demand
    app.post('/api/trigger/:name', async (request, reply) => {
        const { name } = request.params as { name: string };
        const triggered = await scheduler.triggerJob(name);
        if (!triggered) return reply.status(404).send({ error: 'Job not found' });
        return { success: true, message: `Job "${name}" triggered` };
    });

    // Delete a job
    app.delete('/api/cron/:name', async (request, reply) => {
        const { name } = request.params as { name: string };
        const deleted = db.deleteCronJob(name);

        if (!deleted) return reply.status(404).send({ error: 'Job not found' });

        scheduler.removeJob(name);

        return { success: true };
    });
}
