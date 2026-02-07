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

export function sanitizeMarkdown(text: string): string {
    // Telegram MarkdownV2 requires escaping: 
    // _ * [ ] ( ) ~ ` > # + - = | { } . !
    // and backslash itself.
    return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}
