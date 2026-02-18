export const MODEL_ALIASES: Record<string, string> = {
    opus: 'claude-opus-4-5-20250514',
    sonnet: 'claude-sonnet-4-5-20250514',
    haiku: 'claude-haiku-3-5-20241022',
};

export function resolveModel(model: string | undefined): string | undefined {
    if (!model) return undefined;
    return MODEL_ALIASES[model.toLowerCase()] ?? model;
}

export function isKnownAlias(model: string): boolean {
    return model.toLowerCase() in MODEL_ALIASES;
}
