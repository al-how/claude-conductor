import type { OllamaConfig, OpenRouterConfig } from '../config/schema.js';

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

export interface ExecutionTarget {
    provider: 'claude' | 'ollama' | 'openrouter';
    model?: string; // undefined = let CLI pick default
    providerEnv?: Record<string, string>;
}

export interface ResolveParams {
    /** Model from the most specific source: one-off override, sticky, or job model */
    model?: string;
    /** Explicit provider selection */
    provider?: 'claude' | 'openrouter' | 'ollama';
    /** Global model from config.yaml — Claude fallback only */
    globalModel?: string;
    ollamaConfig?: OllamaConfig;
    openRouterConfig?: OpenRouterConfig;
}

const OLLAMA_PREFIX = 'ollama:';

/**
 * Resolves the full execution target (provider, model, env vars) for a Claude CLI invocation.
 *
 * Resolution chains:
 *   Claude:      model override -> globalModel -> undefined (CLI picks default)
 *   OpenRouter:  model override -> openrouter.default_model -> validation error
 *   Ollama:      model override -> ollama.default_model -> validation error
 *
 * Backward compat: model strings starting with 'ollama:' implicitly set provider=ollama.
 * No global Claude model fallback for non-Claude providers.
 */
export function resolveExecutionTarget(params: ResolveParams): ExecutionTarget {
    const { model, globalModel, ollamaConfig, openRouterConfig } = params;
    let { provider } = params;

    // Backward compat: 'ollama:model' prefix implies ollama provider — only when provider is unset
    if (!provider && model?.toLowerCase().startsWith(OLLAMA_PREFIX)) {
        provider = 'ollama';
    }

    const effectiveProvider = provider ?? 'claude';

    if (effectiveProvider === 'claude') {
        const rawModel = model ?? globalModel;
        const resolvedModel = rawModel
            ? (MODEL_ALIASES[rawModel.toLowerCase()] ?? rawModel)
            : undefined;
        return { provider: 'claude', model: resolvedModel };
    }

    if (effectiveProvider === 'ollama') {
        if (!ollamaConfig) {
            throw new Error('Ollama provider requires ollama config in config.yaml');
        }

        // Strip ollama: prefix if present
        const rawModel = model?.toLowerCase().startsWith(OLLAMA_PREFIX)
            ? model.slice(OLLAMA_PREFIX.length)
            : model;

        const resolvedModel = rawModel ?? ollamaConfig.default_model;
        if (!resolvedModel) {
            throw new Error(
                'Ollama provider requires a model. Set ollama.default_model in config.yaml or specify a model'
            );
        }

        // Validate against allowlist (always enforced)
        if (ollamaConfig.allowed_models.length === 0) {
            throw new Error('Ollama allowed_models list is empty in config.yaml. You must list models you want to allow.');
        }

        if (!ollamaConfig.allowed_models.includes(resolvedModel)) {
            throw new Error(`Model '${resolvedModel}' is not in the Ollama allowed_models list`);
        }

        const providerEnv: Record<string, string> = {
            ANTHROPIC_BASE_URL: ollamaConfig.base_url,
            ANTHROPIC_AUTH_TOKEN: 'ollama',
            ANTHROPIC_API_KEY: '',
        };

        return { provider: 'ollama', model: resolvedModel, providerEnv };
    }

    if (effectiveProvider === 'openrouter') {
        if (!openRouterConfig) {
            throw new Error(
                'OpenRouter provider requires openrouter config (api_key, allowed_models) in config.yaml'
            );
        }

        const resolvedModel = model ?? openRouterConfig.default_model;
        if (!resolvedModel) {
            throw new Error(
                'OpenRouter provider requires a model. Set openrouter.default_model in config.yaml or specify a model'
            );
        }

        // Fail-fast allowlist check
        if (openRouterConfig.allowed_models.length === 0) {
            throw new Error('OpenRouter allowed_models list is empty in config.yaml. You must list models you want to allow.');
        }

        if (!openRouterConfig.allowed_models.includes(resolvedModel)) {
            throw new Error(`Model '${resolvedModel}' is not in the OpenRouter allowed_models list`);
        }

        const providerEnv: Record<string, string> = {
            ANTHROPIC_BASE_URL: openRouterConfig.base_url,
            ANTHROPIC_AUTH_TOKEN: openRouterConfig.api_key,
            ANTHROPIC_API_KEY: '',
        };

        return { provider: 'openrouter', model: resolvedModel, providerEnv };
    }

    throw new Error(`Unknown provider: ${effectiveProvider}`);
}

export function isKnownAlias(model: string): boolean {
    return model.toLowerCase() in MODEL_ALIASES;
}

// Legacy types and function kept for backward compatibility during migration
export interface ResolvedModel {
    model: string;
    provider: 'claude' | 'ollama';
}

/** @deprecated Use resolveExecutionTarget instead */
export function resolveModel(model: string | undefined): ResolvedModel | undefined {
    if (!model) return undefined;

    if (model.toLowerCase().startsWith(OLLAMA_PREFIX)) {
        return {
            model: model.slice(OLLAMA_PREFIX.length),
            provider: 'ollama',
        };
    }

    return {
        model: MODEL_ALIASES[model.toLowerCase()] ?? model,
        provider: 'claude',
    };
}
