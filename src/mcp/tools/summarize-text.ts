import type { ModelBackend, McpLogger } from '../backends/types.js';
import { DEFAULT_SUMMARIZE_TIMEOUT_MS, makeFallbackError } from '../backends/types.js';
import { withFallback } from '../utils/fallback.js';

export interface SummarizeTextArgs {
    content: string;
    focus?: string;
}

// Rough estimate: 4 chars per token, Ollama context ~32k tokens
const OLLAMA_CHAR_LIMIT = 100_000;

export async function summarizeText(
    args: SummarizeTextArgs,
    backends: { ollama?: ModelBackend; gemini?: ModelBackend; openai?: ModelBackend },
    logger: McpLogger,
): Promise<string> {
    const { content, focus } = args;

    const systemPrompt = focus
        ? `Summarize the following text, focusing on: ${focus}. Be concise and extract the key points.`
        : 'Summarize the following text concisely. Extract the key points, important facts, and main conclusions.';

    const generateOpts = {
        prompt: content,
        systemPrompt,
        timeoutMs: DEFAULT_SUMMARIZE_TIMEOUT_MS,
    };

    // Build fallback chain — skip Ollama if content exceeds its context limit
    const steps: Array<{ name: string; fn: () => Promise<string> }> = [];

    if (backends.ollama && content.length <= OLLAMA_CHAR_LIMIT) {
        steps.push({
            name: 'ollama',
            fn: async () => (await backends.ollama!.generate(generateOpts)).text,
        });
    }

    if (backends.gemini) {
        steps.push({
            name: 'gemini',
            fn: async () => (await backends.gemini!.generate(generateOpts)).text,
        });
    }

    if (backends.openai) {
        steps.push({
            name: 'openai',
            fn: async () => (await backends.openai!.generate(generateOpts)).text,
        });
    }

    if (steps.length === 0) {
        return JSON.stringify(makeFallbackError('summarize_text'));
    }

    try {
        return await withFallback(steps, logger);
    } catch {
        return JSON.stringify(makeFallbackError('summarize_text'));
    }
}
