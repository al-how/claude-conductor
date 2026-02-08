import { readFileSync, existsSync } from 'node:fs';
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
    const pathsToTry = [
        configPath,
        process.env.CONFIG_PATH,
        './config.local.yaml',
        './config.yaml',
        '/config/config.yaml'
    ].filter(Boolean) as string[];

    let raw: string | undefined;
    let loadedPath: string | undefined;

    for (const path of pathsToTry) {
        if (existsSync(path)) {
            try {
                raw = readFileSync(path, 'utf-8');
                loadedPath = path;
                process.env.CONFIG_PATH = path; // Update env var for other components to see
                break;
            } catch (err) {
                // Ignore read errors, try next
                console.warn(`Failed to read config at ${path}, trying next...`);
            }
        }
    }

    if (!raw || !loadedPath) {
        throw new Error(`Could not find valid config file. Tried: ${pathsToTry.join(', ')}`);
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
