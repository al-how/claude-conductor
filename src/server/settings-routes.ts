import type { FastifyInstance } from 'fastify';
import type { Config } from '../config/schema.js';
import { z } from 'zod/v3';
import { updateConfigField } from '../config/writer.js';

const SettingsPatchSchema = z.object({
    model: z.string().nullable().optional(),
    queue: z.object({
        max_concurrent: z.number().int().min(1).max(10).optional(),
        timeout_seconds: z.number().int().min(30).max(3600).optional(),
    }).optional(),
});

export function registerSettingsRoutes(app: FastifyInstance, config: Config) {
    app.get('/api/settings', async () => {
        return {
            model: config.model ?? null,
            queue: {
                max_concurrent: config.queue.max_concurrent,
                timeout_seconds: config.queue.timeout_seconds,
            },
            vault_path: config.vault_path,
            telegram_enabled: !!config.telegram,
            api_enabled: !!config.api,
            browser: config.browser,
            ollama_enabled: !!config.ollama,
            ollama_base_url: config.ollama?.base_url ?? null,
        };
    });

    app.patch('/api/settings', async (request, reply) => {
        let body: z.infer<typeof SettingsPatchSchema>;
        try {
            body = SettingsPatchSchema.parse(request.body);
        } catch (err) {
            if (err instanceof z.ZodError) {
                return reply.status(400).send({ error: 'Validation failed', details: err.errors });
            }
            throw err;
        }

        // Update model
        if (body.model !== undefined) {
            config.model = body.model ?? undefined;
            updateConfigField('model', body.model);
        }

        // Update queue settings
        if (body.queue) {
            if (body.queue.max_concurrent !== undefined) {
                config.queue.max_concurrent = body.queue.max_concurrent;
                updateConfigField('queue.max_concurrent', body.queue.max_concurrent);
            }
            if (body.queue.timeout_seconds !== undefined) {
                config.queue.timeout_seconds = body.queue.timeout_seconds;
                updateConfigField('queue.timeout_seconds', body.queue.timeout_seconds);
            }
        }

        return {
            model: config.model ?? null,
            queue: {
                max_concurrent: config.queue.max_concurrent,
                timeout_seconds: config.queue.timeout_seconds,
            },
            vault_path: config.vault_path,
            telegram_enabled: !!config.telegram,
            api_enabled: !!config.api,
            browser: config.browser,
            ollama_enabled: !!config.ollama,
            ollama_base_url: config.ollama?.base_url ?? null,
        };
    });
}
