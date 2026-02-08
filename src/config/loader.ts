import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { ConfigSchema, type Config } from './schema.js';

function substituteEnvVars(value: unknown): unknown {
    if (typeof value === 'string') {
        return value.replace(/\$\{([^}]+)\}/g, (_, varName: string) => {
            const envValue = process.env[varName];
            if (envValue === undefined) {
                throw new Error(`Environment variable ${varName} not found`);
            }
            return envValue;
        });
    }
    if (Array.isArray(value)) return value.map(v => substituteEnvVars(v));
    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, substituteEnvVars(v)])
        );
    }
    return value;
}

export function loadConfig(configPath?: string): Config {
    const path = configPath || process.env.CONFIG_PATH || '/config/config.yaml';
    let raw: string;
    try {
        raw = readFileSync(path, 'utf-8');
    } catch (err) {
        throw new Error(`Failed to read config file at ${path}: ${(err as Error).message}`);
    }

    const parsed = parseYaml(raw);
    const substituted = substituteEnvVars(parsed);

    const result = ConfigSchema.safeParse(substituted);
    if (!result.success) {
        const msgs = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
        throw new Error(`Config validation failed: ${msgs}`);
    }
    return result.data;
}
