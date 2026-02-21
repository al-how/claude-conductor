import type { FastifyInstance } from 'fastify';
import type { DatabaseManager } from '../db/index.js';
import type { CronScheduler } from '../cron/scheduler.js';
import { z } from 'zod/v3';
import { CronJobSchema } from '../config/schema.js';
import { MODEL_ALIASES } from '../claude/models.js';

const CronJobCreateSchema = CronJobSchema.extend({
    output: z.enum(['telegram', 'log', 'silent']).default('telegram'),
    enabled: z.number().min(0).max(1).optional(),
});

const CronJobUpdateSchema = CronJobCreateSchema.partial().omit({ name: true });

export function registerCronRoutes(app: FastifyInstance, db: DatabaseManager, scheduler: CronScheduler, apiEnabled: boolean = false, ollamaBaseUrl?: string) {
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

        if (body.execution_mode === 'api' && !apiEnabled) {
            return reply.status(400).send({ error: 'API execution mode requires api config (anthropic_api_key) in config.yaml' });
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
            max_turns: body.max_turns ?? null,
            model: body.model ?? null,
            execution_mode: body.execution_mode,
            allowed_tools: body.allowed_tools ?? null,
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

        if (body.execution_mode === 'api' && !apiEnabled) {
            return reply.status(400).send({ error: 'API execution mode requires api config (anthropic_api_key) in config.yaml' });
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

    // Job execution history
    app.get('/api/cron/:name/history', async (request, reply) => {
        const { name } = request.params as { name: string };
        const { limit } = request.query as { limit?: string };
        const job = db.getCronJob(name);
        if (!job) return reply.status(404).send({ error: 'Job not found' });
        const executions = db.getRecentCronExecutions(name, limit ? parseInt(limit, 10) : 20);
        return { executions };
    });

    // Delete a job
    app.delete('/api/cron/:name', async (request, reply) => {
        const { name } = request.params as { name: string };
        const deleted = db.deleteCronJob(name);

        if (!deleted) return reply.status(404).send({ error: 'Job not found' });

        scheduler.removeJob(name);

        return { success: true };
    });

    // Available model list for the dashboard picker
    app.get('/api/models', async () => {
        const claude = Object.keys(MODEL_ALIASES)
            .filter(k => !k.includes('.'))  // only short names: opus, sonnet, haiku
            .map(k => ({ alias: k, model: MODEL_ALIASES[k] }));
        return { claude };
    });

    // Ollama model discovery
    app.get('/api/ollama/models', async () => {
        if (!ollamaBaseUrl) {
            return { models: [], available: false };
        }
        try {
            const res = await fetch(`${ollamaBaseUrl}/api/tags`);
            if (!res.ok) return { models: [], available: false };
            const data = await res.json() as { models: Array<{ name: string; size: number; modified_at: string }> };
            return {
                models: data.models.map(m => ({ name: m.name, size: m.size, modified_at: m.modified_at })),
                available: true,
            };
        } catch {
            return { models: [], available: false };
        }
    });
}
