const MAX_TOKENS = 3;

export function isStopWord(transcript: string, words: string[]): boolean {
    const normalized = transcript.trim().toLowerCase().replace(/[.!?,;:]+/g, '').trim();
    if (!normalized) return false;

    const tokens = normalized.split(/\s+/);
    if (tokens.length > MAX_TOKENS) return false;

    for (const phrase of words) {
        const phraseTokens = phrase.toLowerCase().trim().split(/\s+/).filter(Boolean);
        if (phraseTokens.length === 0 || phraseTokens.length > tokens.length) continue;

        for (let i = 0; i <= tokens.length - phraseTokens.length; i++) {
            if (phraseTokens.every((p, j) => tokens[i + j] === p)) return true;
        }
    }
    return false;
}
