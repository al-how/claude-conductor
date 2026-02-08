import type { FastifyInstance } from 'fastify';
import type { DatabaseManager } from '../db/index.js';
import type { CronScheduler } from '../cron/scheduler.js';
import { z } from 'zod';

const CronJobSchema = z.object({
    name: z.string().min(1),
    schedule: z.string().min(1),
    prompt: z.string().min(1),
    output: z.enum(['telegram', 'log', 'silent']).default('telegram'),
    enabled: z.number().min(0).max(1).optional()
});

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
        const body = CronJobSchema.parse(request.body);

        const existing = db.getCronJob(body.name);
        if (existing) {
            return reply.status(409).send({ error: 'Job with this name already exists. Use PATCH to update.' });
        }

        const job = db.createCronJob({
            name: body.name,
            schedule: body.schedule,
            prompt: body.prompt,
            output: body.output,
            enabled: body.enabled ?? 1
        });

        scheduler.addJob(job);

        reply.status(201).send({ job });
    });

    // Update a job
    app.patch('/api/cron/:name', async (request, reply) => {
        const { name } = request.params as { name: string };
        const body = request.body as Partial<z.infer<typeof CronJobSchema>>;

        // Basic validation of fields if present
        if (body.schedule && body.schedule.length === 0) return reply.status(400).send({ error: 'Invalid schedule' });
        if (body.prompt && body.prompt.length === 0) return reply.status(400).send({ error: 'Invalid prompt' });

        const job = db.updateCronJob(name, body);
        if (!job) return reply.status(404).send({ error: 'Job not found' });

        scheduler.removeJob(name); // Remove old schedule
        scheduler.addJob(job);     // Add new schedule (if enabled)

        return { job };
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
