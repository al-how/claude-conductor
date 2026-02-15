import type { GeminiBackend } from '../backends/gemini.js';
import { DEFAULT_SUMMARIZE_TIMEOUT_MS, makeFallbackError, type McpLogger } from '../backends/types.js';
import { fetchAndExtract } from '../utils/fetch-url.js';

export interface SummarizeUrlArgs {
    url: string;
    focus?: string;
}

export async function summarizeUrl(
    args: SummarizeUrlArgs,
    gemini: GeminiBackend,
    logger: McpLogger,
): Promise<string> {
    const { url, focus } = args;

    try {
        logger.info({ url }, 'Fetching URL content');
        const fetched = await fetchAndExtract(url);

        const systemPrompt = focus
            ? `Summarize the following web page content, focusing on: ${focus}. Be concise.`
            : 'Summarize the following web page content concisely. Extract key points and main conclusions.';

        const prompt = `Title: ${fetched.title}\n${fetched.byline ? `By: ${fetched.byline}\n` : ''}\n${fetched.content}`;

        logger.info({ title: fetched.title, contentLength: fetched.content.length }, 'Summarizing URL content');
        const response = await gemini.generate({
            prompt,
            systemPrompt,
            timeoutMs: DEFAULT_SUMMARIZE_TIMEOUT_MS,
        });

        logger.info({ tokensUsed: response.tokensUsed }, 'URL summarization complete');
        return response.text;
    } catch (err) {
        logger.error({ err, url }, 'URL summarization failed');
        return JSON.stringify(makeFallbackError('summarize_url'));
    }
}
