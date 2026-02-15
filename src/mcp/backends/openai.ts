import OpenAI from 'openai';
import type { GenerateOptions, ModelBackend, ModelResponse } from './types.js';

export class OpenAIBackend implements ModelBackend {
    readonly name = 'openai';
    private client: OpenAI;
    private model: string;

    constructor(apiKey: string, model: string = 'gpt-4o-mini') {
        this.client = new OpenAI({ apiKey });
        this.model = model;
    }

    async checkHealth(): Promise<boolean> {
        try {
            const response = await this.client.chat.completions.create({
                model: this.model,
                messages: [{ role: 'user', content: 'ping' }],
                max_tokens: 5,
            });
            return !!response.choices[0]?.message?.content;
        } catch {
            return false;
        }
    }

    async generate(options: GenerateOptions): Promise<ModelResponse> {
        const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

        if (options.systemPrompt) {
            messages.push({ role: 'system', content: options.systemPrompt });
        }
        messages.push({ role: 'user', content: options.prompt });

        const response = await this.client.chat.completions.create({
            model: this.model,
            messages,
            max_tokens: options.maxTokens ?? 4096,
            temperature: options.temperature ?? 0.3,
        }, {
            timeout: options.timeoutMs ?? 30_000,
        });

        return {
            text: response.choices[0]?.message?.content ?? '',
            model: response.model,
            tokensUsed: response.usage?.total_tokens,
        };
    }
}
