import type { Logger } from 'pino';

export interface GenerateOptions {
    prompt: string;
    systemPrompt?: string;
    maxTokens?: number;
    temperature?: number;
    timeoutMs?: number;
}

export interface ModelResponse {
    text: string;
    model: string;
    tokensUsed?: number;
}

export interface ImageAnalysisOptions {
    imageBase64: string;
    mimeType: string;
    prompt: string;
    timeoutMs?: number;
}

export interface ModelBackend {
    name: string;
    checkHealth(): Promise<boolean>;
    generate(options: GenerateOptions): Promise<ModelResponse>;
    analyzeImage?(options: ImageAnalysisOptions): Promise<ModelResponse>;
}

/** Returned to Claude when all backends fail, suggesting it use built-in tools */
export interface FallbackErrorResponse {
    error: true;
    message: string;
    suggestion: string;
}

export function makeFallbackError(toolName: string): FallbackErrorResponse {
    return {
        error: true,
        message: `All backends failed for ${toolName}`,
        suggestion: 'Please use your built-in tools (WebSearch, WebFetch, Read) instead.',
    };
}

export const DEFAULT_RESEARCH_TIMEOUT_MS = 60_000;
export const DEFAULT_SUMMARIZE_TIMEOUT_MS = 30_000;

export type McpLogger = Logger;
