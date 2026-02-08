import { mkdir, writeFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import type { Bot, Context } from 'grammy';

export async function downloadTelegramFile(
    bot: Bot<Context>,
    fileId: string,
    destDir: string,
    filename?: string
): Promise<string> {
    const file = await bot.api.getFile(fileId);
    const filePath = file.file_path;
    if (!filePath) throw new Error('Telegram did not return a file_path');

    const url = `https://api.telegram.org/file/bot${bot.token}/${filePath}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to download file: ${response.status}`);

    const rawName = filename ?? `${fileId}${extname(filePath)}`;
    const safeName = basename(rawName);
    if (!safeName || safeName === '.' || safeName === '..') {
        throw new Error('Invalid filename');
    }
    await mkdir(destDir, { recursive: true });
    const destPath = resolve(destDir, safeName);
    const resolvedDestDir = resolve(destDir);
    if (!destPath.startsWith(resolvedDestDir)) {
        throw new Error('Path traversal detected');
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(destPath, buffer);
    return destPath;
}

export function chunkMessage(text: string, limit = 4096): string[] {
    if (text.length <= limit) return [text];

    const chunks: string[] = [];
    let currentChunk = '';

    const lines = text.split('\n');
    for (const line of lines) {
        if (currentChunk.length + line.length + 1 > limit) {
            if (currentChunk) {
                chunks.push(currentChunk);
                currentChunk = '';
            }
            // If a single line is too long, we must split it
            if (line.length > limit) {
                let remaining = line;
                while (remaining.length > 0) {
                    const part = remaining.slice(0, limit);
                    remaining = remaining.slice(limit);
                    if (remaining.length > 0) {
                        chunks.push(part);
                    } else {
                        currentChunk = part;
                    }
                }
            } else {
                currentChunk = line;
            }
        } else {
            currentChunk = currentChunk ? currentChunk + '\n' + line : line;
        }
    }
    if (currentChunk) chunks.push(currentChunk);

    return chunks;
}

export function escapePromptContent(content: string): string {
    return content.replace(/</g, '\u2039').replace(/>/g, '\u203A');
}

export function sanitizeMarkdown(text: string): string {
    // Telegram MarkdownV2 requires escaping: 
    // _ * [ ] ( ) ~ ` > # + - = | { } . !
    // and backslash itself.
    return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}
