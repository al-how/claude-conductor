import type { ModelBackend, McpLogger } from '../backends/types.js';
import { DEFAULT_RESEARCH_TIMEOUT_MS, makeFallbackError } from '../backends/types.js';
import { withFallback } from '../utils/fallback.js';

export interface AnalyzeComplexArgs {
    content: string;
    question: string;
}

export async function analyzeComplex(
    args: AnalyzeComplexArgs,
    backends: { openai?: ModelBackend; gemini?: ModelBackend },
    logger: McpLogger,
): Promise<string> {
    const { content, question } = args;

    const generateOpts = {
        prompt: `${question}\n\n---\n\n${content}`,
        systemPrompt: 'You are an expert analyst. Analyze the provided content carefully and answer the question thoroughly. Provide structured, detailed reasoning.',
        timeoutMs: DEFAULT_RESEARCH_TIMEOUT_MS,
    };

    const steps: Array<{ name: string; fn: () => Promise<string> }> = [];

    if (backends.openai) {
        steps.push({
            name: 'openai',
            fn: async () => (await backends.openai!.generate(generateOpts)).text,
        });
    }

    if (backends.gemini) {
        steps.push({
            name: 'gemini',
            fn: async () => (await backends.gemini!.generate(generateOpts)).text,
        });
    }

    if (steps.length === 0) {
        return JSON.stringify(makeFallbackError('analyze_complex'));
    }

    try {
        return await withFallback(steps, logger);
    } catch {
        return JSON.stringify(makeFallbackError('analyze_complex'));
    }
}
