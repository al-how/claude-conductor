export const MODEL_ALIASES: Record<string, string> = {
    'opus': 'claude-opus-4-6',
    'opus-4.6': 'claude-opus-4-6',
    'opus-4.5': 'claude-opus-4-5-20250514',
    'sonnet': 'claude-sonnet-4-6',
    'sonnet-4.6': 'claude-sonnet-4-6',
    'sonnet-4.5': 'claude-sonnet-4-5-20250514',
    'haiku': 'claude-haiku-4-5-20251001',
    'haiku-4.5': 'claude-haiku-4-5-20251001',
};

export interface ResolvedModel {
    model: string;
    provider: 'claude' | 'ollama';
}

const OLLAMA_PREFIX = 'ollama:';

export function resolveModel(model: string | undefined): ResolvedModel | undefined {
    if (!model) return undefined;

    // Check for ollama: prefix
    if (model.toLowerCase().startsWith(OLLAMA_PREFIX)) {
        return {
            model: model.slice(OLLAMA_PREFIX.length),
            provider: 'ollama',
        };
    }

    // Claude alias or pass-through
    return {
        model: MODEL_ALIASES[model.toLowerCase()] ?? model,
        provider: 'claude',
    };
}

export function isKnownAlias(model: string): boolean {
    return model.toLowerCase() in MODEL_ALIASES;
}
