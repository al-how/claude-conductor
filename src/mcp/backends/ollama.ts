import type { GenerateOptions, ImageAnalysisOptions, ModelBackend, ModelResponse } from './types.js';

export class OllamaBackend implements ModelBackend {
    readonly name = 'ollama';
    private host: string;
    private model: string;

    constructor(host: string = 'http://host.docker.internal:11434', model: string = 'qwen3-vl:8b') {
        this.host = host.replace(/\/$/, '');
        this.model = model;
    }

    async checkHealth(): Promise<boolean> {
        try {
            const response = await fetch(`${this.host}/api/tags`, {
                signal: AbortSignal.timeout(5_000),
            });
            return response.ok;
        } catch {
            return false;
        }
    }

    async generate(options: GenerateOptions): Promise<ModelResponse> {
        const timeout = options.timeoutMs ?? 30_000;

        const body: Record<string, unknown> = {
            model: this.model,
            prompt: options.prompt,
            stream: false,
            options: {
                temperature: options.temperature ?? 0.3,
                num_predict: options.maxTokens ?? 4096,
            },
        };
        if (options.systemPrompt) {
            body.system = options.systemPrompt;
        }

        const response = await fetch(`${this.host}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(timeout),
        });

        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new Error(`Ollama API error ${response.status}: ${text}`);
        }

        const data = await response.json() as {
            response: string;
            model: string;
            eval_count?: number;
            prompt_eval_count?: number;
        };

        return {
            text: data.response,
            model: data.model,
            tokensUsed: (data.eval_count ?? 0) + (data.prompt_eval_count ?? 0),
        };
    }

    async analyzeImage(options: ImageAnalysisOptions): Promise<ModelResponse> {
        const timeout = options.timeoutMs ?? 60_000;

        const body = {
            model: this.model,
            prompt: options.prompt,
            images: [options.imageBase64],
            stream: false,
            options: {
                temperature: 0.3,
                num_predict: 4096,
            },
        };

        const response = await fetch(`${this.host}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(timeout),
        });

        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new Error(`Ollama API error ${response.status}: ${text}`);
        }

        const data = await response.json() as {
            response: string;
            model: string;
            eval_count?: number;
            prompt_eval_count?: number;
        };

        return {
            text: data.response,
            model: data.model,
            tokensUsed: (data.eval_count ?? 0) + (data.prompt_eval_count ?? 0),
        };
    }
}
