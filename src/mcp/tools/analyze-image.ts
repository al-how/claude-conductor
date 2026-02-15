import { readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import type { OllamaBackend } from '../backends/ollama.js';
import { makeFallbackError, type McpLogger } from '../backends/types.js';

export interface AnalyzeImageArgs {
    image_path: string;
    question?: string;
}

const MIME_TYPES: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
};

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

export async function analyzeImage(
    args: AnalyzeImageArgs,
    ollama: OllamaBackend,
    logger: McpLogger,
): Promise<string> {
    const { image_path, question } = args;

    try {
        const stat = statSync(image_path);
        if (stat.size > MAX_IMAGE_SIZE) {
            return JSON.stringify({
                error: true,
                message: `Image too large (${Math.round(stat.size / 1024 / 1024)}MB). Maximum is 10MB.`,
                suggestion: 'Please resize the image or use a smaller one.',
            });
        }

        const ext = extname(image_path).toLowerCase();
        const mimeType = MIME_TYPES[ext];
        if (!mimeType) {
            return JSON.stringify({
                error: true,
                message: `Unsupported image format: ${ext}`,
                suggestion: 'Supported formats: PNG, JPEG, GIF, WebP, BMP.',
            });
        }

        const imageBuffer = readFileSync(image_path);
        const imageBase64 = imageBuffer.toString('base64');

        const prompt = question || 'Describe this image in detail. What do you see?';

        logger.info({ image_path, size: stat.size, mimeType }, 'Analyzing image');
        const response = await ollama.analyzeImage({
            imageBase64,
            mimeType,
            prompt,
            timeoutMs: 60_000,
        });

        logger.info({ tokensUsed: response.tokensUsed }, 'Image analysis complete');
        return response.text;
    } catch (err) {
        logger.error({ err, image_path }, 'Image analysis failed');
        return JSON.stringify(makeFallbackError('analyze_image'));
    }
}
