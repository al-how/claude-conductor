import type { FastifyInstance } from 'fastify';
import type { DatabaseManager } from '../db/index.js';
import type { CronScheduler } from '../cron/scheduler.js';
import type { OllamaConfig, OpenRouterConfig } from '../config/schema.js';
import { z } from 'zod/v3';
import { CronJobSchema } from '../config/schema.js';
import { MODEL_ALIASES } from '../claude/models.js';

const CronJobCreateSchema = CronJobSchema.extend({
    output: z.enum(['telegram', 'log', 'silent']).default('telegram'),
    enabled: z.number().min(0).max(1).optional(),
});

const CronJobUpdateSchema = CronJobCreateSchema.partial().omit({ name: true });

export function registerCronRoutes(
    app: FastifyInstance,
    db: DatabaseManager,
    scheduler: CronScheduler,
    apiEnabled: boolean = false,
    ollamaConfig?: OllamaConfig,
    openRouterConfig?: OpenRouterConfig,
) {
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

        if (body.execution_mode === 'api' && body.provider && body.provider !== 'claude') {
            return reply.status(400).send({
                error: `execution_mode 'api' only supports provider 'claude'. Use execution_mode 'cli' for provider '${body.provider}'.`
            });
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
            provider: body.provider ?? null,
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

        // Check combined state: updating provider on an api-mode job, or updating execution_mode to api on a non-Claude provider
        const existing = db.getCronJob(name);
        if (existing) {
            const effectiveMode = body.execution_mode ?? existing.execution_mode;
            const effectiveProvider = body.provider ?? existing.provider ?? 'claude';
            if (effectiveMode === 'api' && effectiveProvider !== 'claude') {
                return reply.status(400).send({
                    error: `execution_mode 'api' only supports provider 'claude'. Use execution_mode 'cli' for provider '${effectiveProvider}'.`
                });
            }
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

    // Provider-grouped model metadata for the dashboard picker
    app.get('/api/models', async () => {
        const claude = Object.keys(MODEL_ALIASES)
            .filter(k => !k.includes('.'))  // only short names: opus, sonnet, haiku
            .map(k => ({ alias: k, model: MODEL_ALIASES[k] }));

        const openrouter = openRouterConfig
            ? { models: openRouterConfig.allowed_models, default_model: openRouterConfig.default_model ?? null }
            : null;

        const ollama = ollamaConfig
            ? { models: ollamaConfig.allowed_models, default_model: ollamaConfig.default_model ?? null }
            : null;

        return { claude, openrouter, ollama };
    });

    // Ollama model discovery (live from Ollama API, for supplemental information)
    app.get('/api/ollama/models', async () => {
        const baseUrl = ollamaConfig?.base_url;
        if (!baseUrl) {
            return { models: [], available: false, error: 'No ollama.base_url configured' };
        }
        try {
            const res = await fetch(`${baseUrl}/api/tags`);
            if (!res.ok) {
                app.log.warn({ status: res.status, baseUrl }, 'Ollama API returned non-OK status');
                return { models: [], available: false, error: `Ollama returned HTTP ${res.status}` };
            }
            const data = await res.json() as { models: Array<{ name: string; size: number; modified_at: string }> };
            return {
                models: data.models.map(m => ({ name: m.name, size: m.size, modified_at: m.modified_at })),
                available: true,
            };
        } catch (err) {
            app.log.warn({ err, baseUrl }, 'Failed to reach Ollama API');
            return { models: [], available: false, error: `Cannot reach Ollama at ${baseUrl}` };
        }
    });
}
