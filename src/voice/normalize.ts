export function normalizeForSpeech(text: string, maxChars: number): string {
    let out = text;

    out = out.replace(/```[\s\S]*?```/g, ' ');
    out = out.replace(/`([^`]+)`/g, '$1');
    out = out.replace(/^\s{0,3}#{1,6}\s+/gm, '');
    out = out.replace(/^\s*[-*+]\s+/gm, '');
    out = out.replace(/^\s*\d+\.\s+/gm, '');
    out = out.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
    out = out.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    out = out.replace(/\*\*([^*]+)\*\*/g, '$1');
    out = out.replace(/__([^_]+)__/g, '$1');
    out = out.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '$1');
    out = out.replace(/(?<!_)_([^_\n]+)_(?!_)/g, '$1');
    out = out.replace(/^\s*>\s?/gm, '');

    out = out.replace(/[ \t]+/g, ' ');
    out = out.replace(/\n{2,}/g, '\n\n');
    out = out.trim();

    if (out.length > maxChars) {
        const truncated = out.slice(0, maxChars);
        const lastBreak = Math.max(
            truncated.lastIndexOf('. '),
            truncated.lastIndexOf('? '),
            truncated.lastIndexOf('! '),
            truncated.lastIndexOf('\n')
        );
        out = (lastBreak > maxChars * 0.6 ? truncated.slice(0, lastBreak + 1) : truncated).trim();
    }

    return out;
}
