import type { GeminiBackend } from '../backends/gemini.js';
import { DEFAULT_RESEARCH_TIMEOUT_MS, makeFallbackError, type McpLogger } from '../backends/types.js';

export interface ResearchWebArgs {
    query: string;
    depth?: 'quick' | 'thorough';
}

export async function researchWeb(
    args: ResearchWebArgs,
    gemini: GeminiBackend,
    logger: McpLogger,
): Promise<string> {
    const { query, depth = 'quick' } = args;

    const systemPrompt = depth === 'thorough'
        ? 'You are a thorough research assistant. Search the web comprehensively for the query. Synthesize findings from multiple sources into a detailed, well-structured summary with key facts, dates, and sources cited.'
        : 'You are a research assistant. Search the web for the query and provide a concise, factual summary of the key findings. Include important details and sources.';

    try {
        logger.info({ query, depth }, 'Starting web research');
        const response = await gemini.generateWithSearch(query, {
            timeoutMs: DEFAULT_RESEARCH_TIMEOUT_MS,
            systemPrompt,
        });
        logger.info({ tokensUsed: response.tokensUsed }, 'Web research complete');
        return response.text;
    } catch (err) {
        logger.error({ err, query }, 'Web research failed');
        return JSON.stringify(makeFallbackError('research_web'));
    }
}
