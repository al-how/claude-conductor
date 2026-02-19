import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod/v3';
import { loadMcpConfig } from './config.js';
import { createMcpLogger } from './logger.js';
import { GeminiBackend } from './backends/gemini.js';
import { OllamaBackend } from './backends/ollama.js';
import { OpenAIBackend } from './backends/openai.js';
import { researchWeb } from './tools/research-web.js';
import { summarizeText } from './tools/summarize-text.js';
import { summarizeUrl } from './tools/summarize-url.js';
import { analyzeImage } from './tools/analyze-image.js';
import { analyzeComplex } from './tools/analyze-complex.js';

async function main() {
    const logger = createMcpLogger(process.env.MCP_LOG_LEVEL || 'info');
    const config = loadMcpConfig();

    // Create backends (only those with credentials/config)
    let gemini: GeminiBackend | undefined;
    let ollama: OllamaBackend | undefined;
    let openai: OpenAIBackend | undefined;

    if (config.geminiApiKey) {
        gemini = new GeminiBackend(config.geminiApiKey, config.geminiModel);
        logger.info({ model: config.geminiModel }, 'Gemini backend configured');
    }

    if (config.ollamaHost) {
        ollama = new OllamaBackend(config.ollamaHost, config.ollamaModel);
        logger.info({ host: config.ollamaHost, model: config.ollamaModel }, 'Ollama backend configured');
    }

    if (config.openaiApiKey) {
        openai = new OpenAIBackend(config.openaiApiKey, config.openaiModel);
        logger.info({ model: config.openaiModel }, 'OpenAI backend configured');
    }

    const server = new McpServer({
        name: 'research',
        version: '1.0.0',
    });

    // Tool: research_web
    server.tool(
        'research_web',
        'Search the web and synthesize findings into a concise summary. Uses Google Search grounding for accurate, up-to-date results. Preferred over WebSearch + WebFetch.',
        {
            query: z.string().describe('The research query or question'),
            depth: z.enum(['quick', 'thorough']).optional().describe('Research depth: quick for brief answers, thorough for comprehensive analysis'),
        },
        async ({ query, depth }) => {
            if (!gemini) {
                return { content: [{ type: 'text' as const, text: 'research_web requires GEMINI_API_KEY to be configured.' }] };
            }
            const result = await researchWeb({ query, depth }, gemini, logger);
            return { content: [{ type: 'text' as const, text: result }] };
        },
    );

    // Tool: summarize_text
    server.tool(
        'summarize_text',
        'Summarize provided text content concisely. Routes to the best available model based on content length. Use for large documents, logs, or any text that needs distilling.',
        {
            content: z.string().describe('The text content to summarize'),
            focus: z.string().optional().describe('Optional focus area for the summary'),
        },
        async ({ content, focus }) => {
            const result = await summarizeText({ content, focus }, { ollama, gemini, openai }, logger);
            return { content: [{ type: 'text' as const, text: result }] };
        },
    );

    // Tool: summarize_url
    server.tool(
        'summarize_url',
        'Fetch a URL and summarize its content. The page is fetched and processed externally — only a concise summary enters your context. Preferred over WebFetch when you only need to understand a page.',
        {
            url: z.string().url().describe('The URL to fetch and summarize'),
            focus: z.string().optional().describe('Optional focus area for the summary'),
        },
        async ({ url, focus }) => {
            if (!gemini) {
                return { content: [{ type: 'text' as const, text: 'summarize_url requires GEMINI_API_KEY to be configured.' }] };
            }
            const result = await summarizeUrl({ url, focus }, gemini, logger);
            return { content: [{ type: 'text' as const, text: result }] };
        },
    );

    // Tool: analyze_image
    server.tool(
        'analyze_image',
        'Analyze an image file using vision AI. Reads the image from disk and processes it with a vision-capable model. Use for understanding screenshots, diagrams, photos, etc.',
        {
            image_path: z.string().describe('Absolute path to the image file'),
            question: z.string().optional().describe('Specific question about the image'),
        },
        async ({ image_path, question }) => {
            if (!ollama) {
                return { content: [{ type: 'text' as const, text: 'analyze_image requires OLLAMA_HOST to be configured.' }] };
            }
            const result = await analyzeImage({ image_path, question }, ollama, logger);
            return { content: [{ type: 'text' as const, text: result }] };
        },
    );

    // Tool: analyze_complex
    server.tool(
        'analyze_complex',
        'Deep analysis of complex content using strong reasoning models. Use for code review, architectural analysis, or any task requiring careful multi-step reasoning.',
        {
            content: z.string().describe('The content to analyze'),
            question: z.string().describe('The analysis question or task'),
        },
        async ({ content, question }) => {
            const result = await analyzeComplex({ content, question }, { openai, gemini }, logger);
            return { content: [{ type: 'text' as const, text: result }] };
        },
    );

    // Connect via stdio transport
    const transport = new StdioServerTransport();
    logger.info('MCP Research server starting on stdio');
    await server.connect(transport);
    logger.info('MCP Research server connected');
}

main().catch((err) => {
    console.error('MCP server fatal error:', err);
    process.exit(1);
});
