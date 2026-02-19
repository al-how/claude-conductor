import { z } from 'zod';

const TelegramConfigSchema = z.object({
    bot_token: z.string().min(1, 'Telegram bot token is required'),
    allowed_users: z.array(z.number().int().positive()).min(1, 'At least one allowed user required')
});

export const CronJobSchema = z.object({
    name: z.string()
        .min(1)
        .max(64)
        .regex(/^[a-zA-Z0-9_-]+$/, 'Job name must contain only letters, numbers, hyphens, and underscores'),
    schedule: z.string().min(1),
    prompt: z.string().min(1),
    output: z.enum(['telegram', 'log', 'webhook', 'silent']).default('log'),
    timezone: z.string().default('America/Chicago'),
    max_turns: z.number().int().min(1).max(200).nullable().optional(),
    model: z.string().optional(),
    execution_mode: z.enum(['api', 'cli']).default('cli')
});

const WebhookRouteSchema = z.object({
    name: z.string().min(1),
    path: z.string().regex(/^\/webhook\/[a-z0-9-]+$/i, 'Webhook path must match /webhook/:name'),
    auth: z.enum(['bearer', 'none']).default('bearer'),
    secret: z.string().optional(),
    prompt_template: z.string().min(1),
    output: z.enum(['telegram', 'log', 'webhook', 'silent']).default('log'),
    model: z.string().optional()
});

const QueueConfigSchema = z.object({
    max_concurrent: z.number().int().min(1).max(10).default(1),
    timeout_seconds: z.number().int().min(30).max(3600).default(300),
    priority: z.object({
        telegram: z.number().int().min(1).max(10).default(1),
        cron: z.number().int().min(1).max(10).default(2),
        webhook: z.number().int().min(1).max(10).default(3)
    }).default({})
}).default({});

const ApiConfigSchema = z.object({
    anthropic_api_key: z.string().min(1),
    default_model: z.string().optional()
});

const BrowserConfigSchema = z.object({
    enabled: z.boolean().default(false),
    headless: z.boolean().default(true),
    vnc: z.boolean().default(false)
}).default({});

export const ConfigSchema = z.object({
    vault_path: z.string().default('/vault'),
    model: z.string().optional(),
    telegram: TelegramConfigSchema.optional(),
    api: ApiConfigSchema.optional(),
    // cron: z.array(CronJobSchema).default([]), // Removed in favor of DB-driven cron
    webhooks: z.array(WebhookRouteSchema).default([]),
    queue: QueueConfigSchema,
    browser: BrowserConfigSchema
});

export type Config = z.infer<typeof ConfigSchema>;
export type TelegramConfig = z.infer<typeof TelegramConfigSchema>;
export type CronJob = z.infer<typeof CronJobSchema>;
export type WebhookRoute = z.infer<typeof WebhookRouteSchema>;
export type QueueConfig = z.infer<typeof QueueConfigSchema>;
export type BrowserConfig = z.infer<typeof BrowserConfigSchema>;
