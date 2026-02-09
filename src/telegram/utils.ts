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

/**
 * Convert Claude's Markdown output to Telegram-compatible HTML.
 * Handles: code blocks, inline code, bold, italic, strikethrough, links, headers.
 * Falls back gracefully — unrecognized markdown passes through as plain text.
 */
export function markdownToTelegramHtml(text: string): string {
    // Step 1: Extract code blocks to protect them from further processing
    const codeBlocks: string[] = [];
    let processed = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
        const escaped = escapeHtml(code.replace(/\n$/, ''));
        const langAttr = lang ? ` class="language-${lang}"` : '';
        const placeholder = `\x00CODEBLOCK${codeBlocks.length}\x00`;
        codeBlocks.push(`<pre><code${langAttr}>${escaped}</code></pre>`);
        return placeholder;
    });

    // Step 2: Extract inline code
    const inlineCode: string[] = [];
    processed = processed.replace(/`([^`\n]+)`/g, (_match, code) => {
        const placeholder = `\x00INLINE${inlineCode.length}\x00`;
        inlineCode.push(`<code>${escapeHtml(code)}</code>`);
        return placeholder;
    });

    // Step 3: Escape HTML entities in remaining text
    processed = escapeHtml(processed);

    // Step 4: Convert markdown syntax to HTML
    // Bold: **text**
    processed = processed.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    // Italic: *text* (but not inside words like file*name)
    processed = processed.replace(/(?<!\w)\*([^\s*](?:.*?[^\s*])?)\*(?!\w)/g, '<i>$1</i>');
    // Strikethrough: ~~text~~
    processed = processed.replace(/~~(.+?)~~/g, '<s>$1</s>');
    // Links: [text](url)
    processed = processed.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    // Headers: # text → bold line
    processed = processed.replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>');
    // Blockquotes: > text
    processed = processed.replace(/^&gt;\s?(.+)$/gm, '<blockquote>$1</blockquote>');

    // Step 5: Restore code blocks and inline code
    for (let i = 0; i < inlineCode.length; i++) {
        processed = processed.replace(`\x00INLINE${i}\x00`, inlineCode[i]);
    }
    for (let i = 0; i < codeBlocks.length; i++) {
        processed = processed.replace(`\x00CODEBLOCK${i}\x00`, codeBlocks[i]);
    }

    return processed;
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
