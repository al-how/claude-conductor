import { z } from 'zod/v3';

const McpConfigSchema = z.object({
    geminiApiKey: z.string().optional(),
    geminiModel: z.string().default('gemini-2.0-flash'),
    openaiApiKey: z.string().optional(),
    openaiModel: z.string().default('gpt-4o-mini'),
    ollamaHost: z.string().default('http://host.docker.internal:11434'),
    ollamaModel: z.string().default('qwen3-vl:8b'),
});

export type McpConfig = z.infer<typeof McpConfigSchema>;

export function loadMcpConfig(): McpConfig {
    return McpConfigSchema.parse({
        geminiApiKey: process.env.GEMINI_API_KEY || undefined,
        geminiModel: process.env.GEMINI_MODEL || undefined,
        openaiApiKey: process.env.OPENAI_API_KEY || undefined,
        openaiModel: process.env.OPENAI_MODEL || undefined,
        ollamaHost: process.env.OLLAMA_HOST || undefined,
        ollamaModel: process.env.OLLAMA_MODEL || undefined,
    });
}
