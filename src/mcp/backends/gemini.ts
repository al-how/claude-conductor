import { GoogleGenAI } from '@google/genai';
import type { GenerateOptions, ModelBackend, ModelResponse } from './types.js';

export class GeminiBackend implements ModelBackend {
    readonly name = 'gemini';
    private client: GoogleGenAI;
    private model: string;

    constructor(apiKey: string, model: string = 'gemini-2.0-flash') {
        this.client = new GoogleGenAI({ apiKey });
        this.model = model;
    }

    async checkHealth(): Promise<boolean> {
        try {
            const response = await this.client.models.generateContent({
                model: this.model,
                contents: 'ping',
                config: { maxOutputTokens: 5 },
            });
            return !!response.text;
        } catch {
            return false;
        }
    }

    async generate(options: GenerateOptions): Promise<ModelResponse> {
        const controller = new AbortController();
        const timeout = options.timeoutMs ?? 60_000;
        const timer = setTimeout(() => controller.abort(), timeout);

        try {
            const response = await this.client.models.generateContent({
                model: this.model,
                contents: options.prompt,
                config: {
                    maxOutputTokens: options.maxTokens ?? 4096,
                    temperature: options.temperature ?? 0.3,
                    systemInstruction: options.systemPrompt,
                },
            });

            return {
                text: response.text ?? '',
                model: this.model,
                tokensUsed: response.usageMetadata?.totalTokenCount,
            };
        } finally {
            clearTimeout(timer);
        }
    }

    /** Generate with Google Search grounding enabled */
    async generateWithSearch(query: string, options?: { timeoutMs?: number; systemPrompt?: string }): Promise<ModelResponse> {
        const controller = new AbortController();
        const timeout = options?.timeoutMs ?? 60_000;
        const timer = setTimeout(() => controller.abort(), timeout);

        try {
            const response = await this.client.models.generateContent({
                model: this.model,
                contents: query,
                config: {
                    systemInstruction: options?.systemPrompt,
                    tools: [{ googleSearch: {} }],
                    temperature: 0.3,
                    maxOutputTokens: 4096,
                },
            });

            return {
                text: response.text ?? '',
                model: this.model,
                tokensUsed: response.usageMetadata?.totalTokenCount,
            };
        } finally {
            clearTimeout(timer);
        }
    }
}
